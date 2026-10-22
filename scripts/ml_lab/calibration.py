"""Blinded teacher packets, validated imports, and a reserved audio-gate test."""
from __future__ import annotations

from collections import Counter, defaultdict
import csv
import json
import math
from pathlib import Path

from .data import DIMENSIONS, SCORE_LEVELS, digest, stamp, write_json, write_jsonl

VERDICTS = ("PASS", "NEEDS_HUMAN_CHECK", "REJECT")
FIELDS = ["sample_id", "instrument", "grade", "rel_video_path", "subset", "verdict",
          *DIMENSIONS, "reviewer_alias", "reviewed_at", "notes"]


def make_packet(rows: list[dict], out: Path, size: int = 200, seed: int = 42) -> dict:
    buckets = defaultdict(list)
    for row in rows:
        if row["audio_available"] and row["video_available"]:
            buckets[row["family"]].append(row)
    for family in buckets:
        buckets[family].sort(key=lambda r: digest(f"{seed}:{r['sample_id']}"))
    chosen, groups = [], set()
    while len(chosen) < size:
        progress = False
        for family in sorted(buckets):
            while buckets[family]:
                row = buckets[family].pop()
                if row["group"] in groups:
                    continue
                groups.add(row["group"])
                chosen.append(row)
                progress = True
                break
            if len(chosen) == size:
                break
        if not progress:
            raise ValueError(f"Need {size} independent downloaded learner groups; found {len(chosen)}")
    # Subsets are fixed before any labels are collected. Separate learners ensure independence.
    chosen.sort(key=lambda r: digest(f"subset:{seed}:{r['sample_id']}"))
    items = []
    for i, row in enumerate(chosen):
        items.append({k: row[k] for k in ("sample_id", "group", "family", "instrument", "grade",
                                         "rel_video_path", "rel_audio_path")})
        items[-1]["subset"] = "calibration" if i < size // 2 else "heldout_test"
    reservation_rows = [r for r in rows if r["group"] in groups]
    write_json(out / "reservation.json", {
        "created_at": stamp(), "seed": seed, "groups": sorted(groups),
        "learners": sorted({r["learner"] for r in reservation_rows}),
        "video_md5s": sorted({r["video_md5"] for r in reservation_rows if r.get("video_md5")}),
    })
    write_jsonl(out / "items.jsonl", items)
    with (out / "teacher_labels.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        for item in items:
            writer.writerow({k: item.get(k, "") for k in FIELDS})
    summary = {"created_at": stamp(), "clips": len(items), "independent_groups": len(groups),
               "by_family": dict(Counter(r["family"] for r in items)),
               "by_subset": dict(Counter(r["subset"] for r in items)),
               "sampling": "Family-balanced, one clip per learner/duplicate-video group, no score conditioning",
               "population_warning": "Family-balanced sample is not representative of archive prevalence",
               "blinded": True, "labels_filled": 0, "ready_for_calibration": False}
    write_json(out / "packet_summary.json", summary)
    (out / "TEACHER_README.md").write_text(
        "# 私有教师复核包\n\n"
        "从数据集目录打开 rel_video_path 对应视频。不要上传到公共网盘或公开网站。\n"
        "只填写 teacher_labels.csv 中的 verdict、五维评分、reviewer_alias、reviewed_at、notes。\n"
        "verdict: PASS / NEEDS_HUMAN_CHECK / REJECT。疑似问题用 NEEDS_HUMAN_CHECK，不强行退回。\n"
        "五维历史数值档位为 0 / 3 / 6 / 10；与‘好/较好/一般/尚可’的对应关系尚未核验。\n"
        "请先确认评分口径，无法判断的维度留空，不参考历史分数或机器建议。\n"
        "reviewer_alias 用内部代号；reviewed_at 用 ISO 8601 时间，例如 2026-10-23T10:00:00+08:00。\n"
        "subset 已提前固定。校准集用于选阈值，heldout_test 只用于最后检查。\n"
        "本包全部学生和重复视频组已保留，后续训练须使用 --packet 排除。\n"
        "样本按乐器家族均衡抽取，错误率不能直接当作全体考生的错误率。\n",
        encoding="utf-8",
    )
    return summary


def validate_labels(packet: Path, csv_path: Path) -> tuple[list[dict], dict]:
    expected = {r["sample_id"]: r for r in map(json.loads, (packet / "items.jsonl").read_text().splitlines())}
    seen, labeled = set(), []
    with csv_path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if not set(FIELDS).issubset(reader.fieldnames or []):
            raise ValueError("Teacher CSV is missing required columns")
        for source in reader:
            sid = source["sample_id"]
            if sid not in expected or sid in seen:
                raise ValueError("Unknown or duplicate teacher sample ID")
            seen.add(sid)
            verdict = source["verdict"].strip()
            ratings = {}
            for dim in DIMENSIONS:
                raw = source[dim].strip()
                if raw and raw not in {str(v) for v in SCORE_LEVELS}:
                    raise ValueError("Teacher ratings must be blank or 0/3/6/10")
                ratings[dim] = int(raw) if raw else None
            if not verdict and not any(v is not None for v in ratings.values()):
                continue
            if verdict not in VERDICTS:
                raise ValueError("Every reviewed row needs PASS, NEEDS_HUMAN_CHECK, or REJECT")
            if not source["reviewer_alias"].strip() or not source["reviewed_at"].strip():
                raise ValueError("Reviewed rows need a reviewer alias and timestamp")
            from datetime import datetime
            reviewed_at = datetime.fromisoformat(source["reviewed_at"])
            if reviewed_at.tzinfo is None:
                raise ValueError("Reviewer timestamps need a timezone")
            # Group, subset and media paths always come from the trusted packet, not edited CSV fields.
            labeled.append({**expected[sid], "verdict": verdict, "labels": ratings,
                            "reviewer_alias": source["reviewer_alias"].strip(),
                            "reviewed_at": reviewed_at.isoformat(), "notes": source["notes"]})
    if seen != set(expected):
        raise ValueError("Teacher CSV must retain all packet rows, including unreviewed rows")
    summary = {"packet_clips": len(expected), "reviewed_clips": len(labeled),
               "pending_clips": len(expected) - len(labeled),
               "by_verdict": dict(Counter(r["verdict"] for r in labeled)),
               "by_subset": dict(Counter(r["subset"] for r in labeled)),
               "rated_dimensions": {d: sum(r["labels"][d] is not None for r in labeled) for d in DIMENSIONS}}
    return labeled, summary


def wilson(errors: int, total: int) -> list[float] | None:
    if not total:
        return None
    z, p = 1.96, errors / total
    denominator = 1 + z * z / total
    center = (p + z * z / (2 * total)) / denominator
    half = z * math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / denominator
    return [round(max(0, center - half), 5), round(min(1, center + half), 5)]


def gate_metrics(rows: list[dict], threshold: float) -> dict:
    good = [r for r in rows if r["verdict"] == "PASS"]
    bad = [r for r in rows if r["verdict"] == "REJECT"]
    fr = sum(r["active_ratio"] < threshold for r in good)
    missed = sum(r["active_ratio"] >= threshold for r in bad)
    return {"reviewed": len(rows), "pass_count": len(good), "reject_count": len(bad),
            "human_check_count": len(rows) - len(good) - len(bad),
            "false_reject_count": fr, "missed_reject_count": missed,
            "false_reject_rate": fr / len(good) if good else None,
            "false_reject_rate_wilson95": wilson(fr, len(good)),
            "missed_reject_rate": missed / len(bad) if bad else None,
            "missed_reject_rate_wilson95": wilson(missed, len(bad))}


def calibrate_gate(rows: list[dict], labeled: list[dict], out: Path, max_false_reject_rate=0.01) -> dict:
    features = {r["sample_id"]: r["features"] for r in rows if r["features"]}
    paired = [{**r, "active_ratio": features[r["sample_id"]]["active_ratio"]} for r in labeled
              if r["sample_id"] in features]
    calibration = [r for r in paired if r["subset"] == "calibration"]
    heldout = [r for r in paired if r["subset"] == "heldout_test"]
    ready = all(sum(r["verdict"] == v for r in subset) >= 5
                for subset in [calibration, heldout] for v in ["PASS", "REJECT"])
    report = {"created_at": stamp(), "production_ready": False,
              "scope": "Audio active-ratio silence heuristic only; not the full multimodal initial-review gate",
              "status": "evaluated" if ready else "awaiting_teacher_labels_and_feature_coverage",
              "reviewed_with_features": len(paired), "reviewed_without_features": len(labeled) - len(paired),
              "max_observed_calibration_false_reject_rate": max_false_reject_rate,
              "calibration": gate_metrics(calibration, 0.35), "heldout_test": gate_metrics(heldout, 0.35),
              "limitations": ["Family-balanced sample; no population error-rate claim.",
                              "A non-flagged clip is not an automatic pass.",
                              "Small samples cannot demonstrate a low production false-reject rate."]}
    if ready:
        candidates = [i / 100 for i in range(0, 51)]
        allowed = [t for t in candidates if gate_metrics(calibration, t)["false_reject_rate"] <= max_false_reject_rate]
        threshold = min(allowed, key=lambda t: (gate_metrics(calibration, t)["missed_reject_rate"], t))
        report.update(selected_threshold=threshold, calibration=gate_metrics(calibration, threshold),
                      heldout_test=gate_metrics(heldout, threshold))
    write_json(out / "gate_calibration.json", report)
    return report
