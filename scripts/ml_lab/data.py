"""Read-only dataset audit and safe, reproducible experiment snapshots."""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit

DIMENSIONS = ("yinzhun_pitch", "jiezou_rhythm", "yinse_tone",
              "biaoxianli_expression", "wanzhengxing_completeness")
SCORE_LEVELS = (0, 3, 6, 10)
ACOUSTIC_FEATURES = (
    "duration_sec", "active_ratio", "pause_count", "longest_pause_sec",
    "rms_db_mean", "rms_db_std", "dynamic_range_db", "phrase_modulation_db",
    "onset_rate_per_sec", "tempo_cv", "rhythm_instability_ratio",
    "spectral_centroid_hz_mean", "spectral_centroid_hz_std", "spectral_flatness_mean",
    "hf_harsh_ratio", "pitch_clarity_mean", "pitch_clarity_std", "pitch_instability_ratio",
)
FAMILIES = {
    "钢琴": "keyboard", "电子琴（单、双排键）": "keyboard", "电子琴（单排键）": "keyboard",
    "古筝": "plucked_strings", "琵琶": "plucked_strings", "古琴": "plucked_strings",
    "民谣吉他": "plucked_strings", "古典吉他": "plucked_strings", "中阮及大阮": "plucked_strings",
    "小提琴": "bowed_strings", "二胡": "bowed_strings", "大提琴": "bowed_strings",
    "长笛": "winds", "竹笛": "winds", "葫芦丝": "winds", "萨克斯管": "winds",
    "单簧管": "winds", "陶笛": "winds",
    "爵士鼓（电爵士鼓）": "percussion", "小军鼓": "percussion",
    "少儿歌唱": "voice", "民族": "voice", "通俗": "voice",
}


def stamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def write_json(path: Path, value) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
    tmp.replace(path)


def write_jsonl(path: Path, rows: list[dict]) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n")
    tmp.replace(path)


def clip_key(row: dict) -> str:
    return f"{row['season_code']}:{row['clip_id']}"


def media_path(root: Path, relative: str, folder: str) -> Path:
    p = PurePosixPath(relative)
    if p.is_absolute() or ".." in p.parts or not p.parts or p.parts[0] != folder:
        raise ValueError(f"Unsafe {folder} path in manifest")
    # videos is deliberately a symlink to DAS4T; keep paths within that approved target.
    resolved = (root / relative).resolve()
    if not resolved.is_relative_to((root / folder).resolve()):
        raise ValueError(f"Media path leaves the approved {folder} directory")
    return resolved


def new_output(root: Path, out: Path) -> Path:
    out = out.resolve()
    protected = [root.resolve(), (root / "videos").resolve(), (root / "audio_24k").resolve(),
                 Path("/opt/stacks/musicexamaid").resolve()]
    if out == protected[0] or any(out.is_relative_to(p) for p in protected[1:]):
        raise ValueError("Experiment output may not replace dataset media or production files")
    out.mkdir(parents=True, exist_ok=False, mode=0o700)
    return out


def provenance(paths: list[Path]) -> dict:
    return {str(p): {"sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
                     "bytes": p.stat().st_size} for p in paths}


def load_dataset(root: Path, extra_cache: Path | list[Path] | None = None) -> tuple[list[dict], dict]:
    manifest = root / "manifest_all_clips.jsonl"
    cache_path = root / "acoustic_features_cache.jsonl"
    manifest_rows = read_jsonl(manifest)
    seen = set()
    for r in manifest_rows:
        key = clip_key(r)
        if key in seen:
            raise ValueError("Duplicate season/clip key in manifest")
        seen.add(key)

    # Connect recordings from the same learner or identical source video. This also
    # keeps duplicate videos credited to different learner IDs in one validation group.
    parents: dict[str, str] = {}

    def find(x: str) -> str:
        parents.setdefault(x, x)
        if parents[x] != x:
            parents[x] = find(parents[x])
        return parents[x]

    first_video: dict[str, str] = {}
    for r in manifest_rows:
        learner = r.get("learner_anon_id")
        if not learner:
            continue
        find(learner)
        md5 = str(r.get("video_md5") or "").strip()
        source = urlsplit(str(r.get("source_url") or ""))
        identities = (["md5:" + md5] if md5 else []) + (["url:" + source.netloc + source.path]
                      if source.netloc and source.path else [])
        for identity in identities:
            other = first_video.setdefault(identity, learner)
            a, b = find(learner), find(other)
            parents[max(a, b)] = min(a, b)

    cache: dict[str, dict] = {}
    paths = [manifest]
    extras = [] if extra_cache is None else ([extra_cache] if isinstance(extra_cache, Path) else extra_cache)
    for path in [cache_path, *extras]:
        if path is None or not path.exists():
            continue
        paths.append(path)
        for entry in read_jsonl(path):
            key = clip_key(entry)
            if key in cache and cache[key].get("features") != entry.get("features"):
                raise ValueError("Conflicting duplicate feature rows; choose one cache explicitly")
            cache[key] = entry

    counts = Counter()
    by_family: dict[str, Counter] = defaultdict(Counter)
    class_counts = {d: Counter() for d in DIMENSIONS}
    rows = []
    for r in manifest_rows:
        counts["manifest_clips"] += 1
        if not r.get("oss_live_expected"):
            counts["outside_live_seasons"] += 1
            continue
        if not r.get("learner_anon_id"):
            counts["missing_learner_id"] += 1
            continue
        family = FAMILIES.get(r["instrument_cn"], "other")
        if family == "other":
            counts["unmapped_instrument"] += 1
        audio = media_path(root, r["rel_audio_path"], "audio_24k")
        video = media_path(root, r["rel_video_path"], "videos")
        audio_ok = audio.is_file() and audio.stat().st_size >= 4096
        video_ok = video.is_file() and video.stat().st_size >= 1024
        entry = cache.get(clip_key(r))
        features = (entry or {}).get("features", {})
        valid_features = all(isinstance(features.get(k), (int, float)) and
                             math.isfinite(features[k]) for k in ACOUSTIC_FEATURES)
        scores = r.get("score_5d") or {}
        all_zero = all(scores.get(d) == 0 for d in DIMENSIONS)
        if all_zero:
            counts["ambiguous_all_zero_labels"] += 1
        invalid = any(v is not None and v not in SCORE_LEVELS for v in scores.values())
        if invalid:
            counts["unsupported_score_values"] += 1
        counts["downloaded_video_clips"] += video_ok
        counts["extracted_audio_clips"] += audio_ok
        counts["valid_cached_feature_clips"] += audio_ok and valid_features
        labels = {d: scores.get(d) if not all_zero and not invalid else None for d in DIMENSIONS}
        if audio_ok and valid_features:
            for d, value in labels.items():
                if value is not None:
                    class_counts[d][str(value)] += 1
        by_family[family]["downloaded"] += video_ok
        by_family[family]["audio"] += audio_ok
        by_family[family]["features"] += audio_ok and valid_features
        row = {"sample_id": digest(clip_key(r))[:20], "clip_key": clip_key(r),
               "exam_key": f"{r['season_code']}:{r['exam_id']}",
               "group": digest(find(r["learner_anon_id"]))[:24],
               "learner": r["learner_anon_id"], "video_md5": r.get("video_md5"),
               "family": family, "instrument": r["instrument_cn"],
               "grade": int(r["grade_level"]), "season": str(r["season_code"]),
               "rel_audio_path": r["rel_audio_path"], "rel_video_path": r["rel_video_path"],
               "audio_available": audio_ok, "video_available": video_ok,
               "features": {k: features[k] for k in ACOUSTIC_FEATURES} if valid_features else None,
               "labels": labels}
        rows.append(row)
    audit = {"as_of": stamp(), "counts": dict(counts), "by_family": dict(by_family),
             "cached_class_counts": class_counts, "native_score_levels": SCORE_LEVELS,
             "zero_policy": "Exclude all-zero exams as ambiguous; retain mixed zero scores",
             "grouping": "Connected components of learner_anon_id, nonempty video_md5 and source host/path",
             "source_files": provenance(paths)}
    return rows, audit


def reserved_groups(rows: list[dict], packet: Path) -> set[str]:
    reserve = json.loads((packet / "reservation.json").read_text())
    learners, md5s = set(reserve["learners"]), set(reserve["video_md5s"])
    return {r["group"] for r in rows if r["learner"] in learners or
            (r.get("video_md5") and r["video_md5"] in md5s)}


def feature_dict(row: dict, variant: str) -> dict:
    result = dict(row["features"]) if variant != "context_only" else {}
    if variant != "acoustic_only":
        result.update(grade=row["grade"] / 11.0, instrument=row["instrument"])
    return result
