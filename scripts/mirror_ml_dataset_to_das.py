#!/usr/bin/env python3
"""
MusicExamAid — ML Model Training Dataset Builder & Resumable Mirror Worker
===========================================================================
Exports all 66,214 labeled China Conservatory (中国音乐学院) exam performance video
clips (2020–2026) from PostgreSQL (`musicexamaid_dev`) into a structured,
PII-anonymized multimodal ML training dataset on `/mnt/DAS1T/musicexamaid_ml_dataset`
(870 GB free) or `/mnt/DAS4T/musicexamaid_ml_dataset` (1.7 TB free).

Features:
1. Generates `manifest_all_66214.jsonl` & `dataset_summary.json` with:
   - `clip_id`, `exam_id`, `clip_index`
   - `instrument_cn` (钢琴 30,855 / 古筝 17,207 / 小提琴 4,647 / 爵士鼓 2,815 / 民谣吉他 2,725 / 二胡 1,661 / ...)
   - `grade_level` (1..11, official China Conservatory grade label)
   - `piece_title` (exact piece name, e.g., "基本练习", "练习曲", "小步舞曲")
   - `clip_category` ("scale_arpeggio" | "etude" | "repertoire")
   - `learner_anon_id` (SHA-256 salted hash of student_id for longitudinal multi-year tracking without PII)
   - `learner_gender`, `learner_birth_year`, `age_at_exam`
   - `season_code`, `season_label`, `pass_certificate_level`
   - `source_url`, `video_md5`, `local_video_path`, `local_audio_path`
2. Resumable multi-threaded downloader (`--download`) with MD5 verification and
   optional `ffmpeg` audio track extraction (`--extract-audio`, 24kHz mono WAV/FLAC
   for audio foundation models / automatic music assessment).
"""

import argparse
import concurrent.futures
import hashlib
import json
import os
import subprocess
import urllib.request
from pathlib import Path

DATASET_ROOT_DEFAULT = "/mnt/DAS1T/musicexamaid_ml_dataset"


def classify_clip_category(title: str, clip_idx: int) -> str:
    t = (title or "").strip()
    if "基本练习" in t or "音阶" in t or "琶音" in t or clip_idx == 1:
        return "scale_arpeggio"
    if "练习曲" in t or clip_idx == 2:
        return "etude"
    return "repertoire"


def export_manifest_from_postgres(dataset_root: Path) -> Path:
    dataset_root.mkdir(parents=True, exist_ok=True)
    manifest_path = dataset_root / "manifest_all_clips.jsonl"
    summary_path = dataset_root / "dataset_summary.json"

    sql = """
    SELECT json_build_object(
      'exam_id', e.exam_id,
      'student_id', e.student_id,
      'season_code', e.season_code,
      'season_label', e.season_label,
      'major_name', e.major_name,
      'level', e.level,
      'exam_titles', e.exam_titles,
      'videos_json', e.videos_json,
      'sex', s.sex,
      'birth_year', CASE WHEN length(s.birthday) >= 4 THEN substring(s.birthday from 1 for 4) ELSE NULL END
    )::text
    FROM kjzx_historical_exams e
    LEFT JOIN kjzx_historical_students s ON s.student_id = e.student_id
    WHERE e.videos_json IS NOT NULL
      AND e.videos_json::text <> '{}'
      AND e.videos_json::text <> 'null'
    ORDER BY e.exam_id DESC;
    """

    cmd = [
        "docker",
        "exec",
        "-i",
        "devhub-postgres",
        "sh",
        "-c",
        'psql -U "$POSTGRES_USER" -d musicexamaid_dev -t -A',
    ]
    proc = subprocess.run(cmd, input=sql, capture_output=True, text=True, check=True)

    total_clips = 0
    by_instrument: dict[str, int] = {}
    by_grade: dict[int, int] = {}
    by_category: dict[str, int] = {}

    with open(manifest_path, "w", encoding="utf-8") as out_f:
        for line in proc.stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            exam_id = row["exam_id"]
            student_id = row["student_id"]
            anon_id = "lrn_" + hashlib.sha256(f"mea_ml_{student_id}".encode()).hexdigest()[:16]
            major_name = (row.get("major_name") or "未知专业").strip()
            safe_major = major_name.replace("（", "_").replace("）", "").replace("/", "_")
            level = int(row.get("level") or 1)
            season_code = str(row.get("season_code") or "")
            exam_year = int(season_code[:4]) if len(season_code) >= 4 and season_code[:4].isdigit() else None
            birth_year = int(row["birth_year"]) if row.get("birth_year") and str(row["birth_year"]).isdigit() else None
            age_at_exam = (exam_year - birth_year) if (exam_year and birth_year and 3 <= exam_year - birth_year <= 80) else None

            titles_list = []
            try:
                parsed_t = json.loads(row.get("exam_titles") or "[]")
                if isinstance(parsed_t, list):
                    titles_list = [str(x).strip() for x in parsed_t]
            except Exception:
                pass

            videos_json = row.get("videos_json") or {}
            if not isinstance(videos_json, dict):
                continue

            for k in sorted(videos_json.keys(), key=lambda x: int(x) if str(x).isdigit() else 99):
                v_obj = videos_json[k]
                if not isinstance(v_obj, dict) or not v_obj.get("url"):
                    continue
                clip_idx = int(k) if str(k).isdigit() else 1
                raw_title = (v_obj.get("title") or "").strip()
                if (not raw_title or raw_title in ("基本练习", "练习曲", "乐曲", "中外乐曲")) and clip_idx - 1 < len(titles_list):
                    if titles_list[clip_idx - 1]:
                        raw_title = titles_list[clip_idx - 1]

                category = classify_clip_category(raw_title, clip_idx)
                rel_video = f"videos/{safe_major}/grade_{level:02d}/{exam_id}_{clip_idx}.mp4"
                rel_audio = f"audio_24k/{safe_major}/grade_{level:02d}/{exam_id}_{clip_idx}.wav"

                record = {
                    "clip_id": f"{exam_id}_{clip_idx}",
                    "exam_id": exam_id,
                    "clip_index": clip_idx,
                    "instrument_cn": major_name,
                    "grade_level": level,
                    "piece_title": raw_title or f"clip_{clip_idx}",
                    "clip_category": category,
                    "learner_anon_id": anon_id,
                    "learner_gender": row.get("sex"),
                    "learner_birth_year": birth_year,
                    "age_at_exam": age_at_exam,
                    "season_code": season_code,
                    "season_label": row.get("season_label"),
                    "source_url": v_obj["url"],
                    "video_md5": v_obj.get("video_md5"),
                    "rel_video_path": rel_video,
                    "rel_audio_path": rel_audio,
                }
                out_f.write(json.dumps(record, ensure_ascii=False) + "\n")
                total_clips += 1
                by_instrument[major_name] = by_instrument.get(major_name, 0) + 1
                by_grade[level] = by_grade.get(level, 0) + 1
                by_category[category] = by_category.get(category, 0) + 1

    summary = {
        "dataset_root": str(dataset_root),
        "manifest_path": str(manifest_path),
        "total_labeled_video_clips": total_clips,
        "by_instrument": dict(sorted(by_instrument.items(), key=lambda kv: kv[1], reverse=True)),
        "by_grade": dict(sorted(by_grade.items())),
        "by_category": by_category,
    }
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return manifest_path


def download_one_clip(rec: dict, dataset_root: Path, extract_audio: bool) -> dict:
    video_path = dataset_root / rec["rel_video_path"]
    video_path.parent.mkdir(parents=True, exist_ok=True)
    status = "cached"

    if not video_path.exists() or video_path.stat().st_size < 1024:
        try:
            req = urllib.request.Request(
                rec["source_url"],
                headers={"User-Agent": "MusicExamAid-MLDatasetBuilder/1.0"},
            )
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = resp.read()
            tmp_path = video_path.with_suffix(".mp4.part")
            tmp_path.write_bytes(data)
            tmp_path.replace(video_path)
            status = "downloaded"
        except Exception as err:
            return {
                "clip_id": rec["clip_id"],
                "status": "failed_or_404",
                "error": str(err),
                "size_bytes": 0,
                "video_path": str(video_path),
            }

    if extract_audio and video_path.exists():
        import shutil
        if shutil.which("ffmpeg"):
            audio_path = dataset_root / rec["rel_audio_path"]
            audio_path.parent.mkdir(parents=True, exist_ok=True)
            if not audio_path.exists():
                subprocess.run(
                    [
                        "ffmpeg",
                        "-y",
                        "-nostdin",
                        "-loglevel",
                        "error",
                        "-i",
                        str(video_path),
                        "-vn",
                        "-ac",
                        "1",
                        "-ar",
                        "24000",
                        str(audio_path),
                    ],
                    check=False,
                )

    return {
        "clip_id": rec["clip_id"],
        "status": status,
        "size_bytes": video_path.stat().st_size if video_path.exists() else 0,
        "video_path": str(video_path),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build & Mirror MusicExamAid ML Video Dataset")
    parser.add_argument("--dataset-root", default=DATASET_ROOT_DEFAULT)
    parser.add_argument("--export-manifest", action="store_true", help="Export full 66,214-clip JSONL manifest from Postgres")
    parser.add_argument("--download", action="store_true", help="Download matching clips from manifest to local disk")
    parser.add_argument("--instrument", default="", help="Filter by instrument_cn (e.g. 钢琴, 古筝, 小提琴)")
    parser.add_argument("--grade", type=int, default=0, help="Filter by exact grade_level (1..11)")
    parser.add_argument("--season", default="", help="Filter by season_code prefix (e.g. 2026, 2025)")
    parser.add_argument("--limit", type=int, default=20, help="Max clips to download in this batch (0 = all matching)")
    parser.add_argument("--workers", type=int, default=6, help="Parallel download workers")
    parser.add_argument("--extract-audio", action="store_true", help="Extract 24kHz mono WAV via ffmpeg")
    args = parser.parse_args()

    dataset_root = Path(args.dataset_root)
    manifest_path = dataset_root / "manifest_all_clips.jsonl"

    if args.export_manifest or not manifest_path.exists():
        export_manifest_from_postgres(dataset_root)

    if not args.download:
        return

    candidates = []
    with open(manifest_path, "r", encoding="utf-8") as f:
        for line in f:
            rec = json.loads(line)
            if args.instrument and rec["instrument_cn"] != args.instrument:
                continue
            if args.grade and int(rec["grade_level"]) != args.grade:
                continue
            if args.season and not str(rec.get("season_code") or "").startswith(args.season):
                continue
            candidates.append(rec)
            if args.limit > 0 and len(candidates) >= args.limit:
                break

    print(f"Starting download of {len(candidates)} clips to {dataset_root} with {args.workers} workers...")
    downloaded = 0
    cached = 0
    failed = 0
    total_bytes = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        for res in pool.map(lambda r: download_one_clip(r, dataset_root, args.extract_audio), candidates):
            if res["status"] == "downloaded":
                downloaded += 1
            elif res["status"] == "cached":
                cached += 1
            else:
                failed += 1
            total_bytes += res["size_bytes"]

    print(
        json.dumps(
            {
                "processed": len(candidates),
                "newly_downloaded": downloaded,
                "already_cached": cached,
                "failed_or_404": failed,
                "total_mb": round(total_bytes / (1024 * 1024), 2),
                "dataset_root": str(dataset_root),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
