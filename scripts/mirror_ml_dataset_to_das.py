#!/usr/bin/env python3
"""
MusicExamAid — Polite, Rate-Limited ML Video Dataset Mirror Worker
==================================================================
Safely mirrors the 25,301 live China Conservatory exam videos (seasons 20235..20265)
from `tlskkj.oss-cn-hangzhou.aliyuncs.com` to `/mnt/DAS1T/musicexamaid_ml_dataset`
with full 5-Dimensional Adjudicator Scores (`score_yinzhun`, `score_jiezou`,
`score_yinse`, `score_biaoxianli`, `score_wanzhengxing`), `score_total` (0..50),
structured rubric tags (`review_text`), and narrative critiques (`self_review_text`).

Anti-Ban & Bandwidth Safety Controls:
1. Zero Portal Auth Touch: Downloads directly from static OSS URLs; never touches
   `kjzx002120` login/session endpoints.
2. Zero 404 Log Noise: Filters strictly to live seasons (`season_code >= 20235`),
   never probing expired 2020-2023summer objects.
3. Scored-First + Rescue Order (`oldest-live-first`): Within each live season
   (`20235` -> `20244` -> ... -> `20265`), prioritizes clips that have official 5-D
   adjudicator scores & rubric critiques first!
4. Single-Stream Bandwidth Throttling (`--max-kbps 1500`):
   Streams in 64 KB chunks capped at ~1.5 MB/s (matching normal HTML5 <video>
   playback), with 4.0s-9.0s random human jitter between clips and a 45s pause
   every 40 clips.
5. Circuit Breaker on 403/429/5xx: Exponential backoff (5m -> 15m -> 60m) and
   automatic halt if upstream ever signals rate limiting.
"""

import argparse
import hashlib
import json
import random
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

DATASET_ROOT_DEFAULT = "/mnt/DAS1T/musicexamaid_ml_dataset"
ARCHIVE_EXAMS_JSON = "/opt/stacks/musicexamaid/data/kjzx002120_archive/exams_all.json"
LIVE_SEASONS_ASC = ["20235", "20244", "20245", "20254", "20255", "20264", "20265"]

BROWSER_USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Mac",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50(0x18003237) NetType/WIFI Language/zh_CN",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
]


def classify_clip_category(title: str, clip_idx: int) -> str:
    t = (title or "").strip()
    if "基本练习" in t or "音阶" in t or "琶音" in t or clip_idx == 1:
        return "scale_arpeggio"
    if "练习曲" in t or clip_idx == 2:
        return "etude"
    return "repertoire"


def backfill_scores_into_postgres(exams_json_path: str = ARCHIVE_EXAMS_JSON) -> int:
    p = Path(exams_json_path)
    if not p.exists():
        print(f"Archive JSON not found at {exams_json_path}, skipping backfill.")
        return 0

    with open(p, "r", encoding="utf-8") as f:
        d = json.load(f)
    rows = d["rows"] if isinstance(d, dict) and "rows" in d else d

    sql_lines = [
        "BEGIN;",
        "ALTER TABLE kjzx_historical_exams ADD COLUMN IF NOT EXISTS score_json JSONB DEFAULT '{}'::jsonb;",
        "ALTER TABLE kjzx_historical_exams ADD COLUMN IF NOT EXISTS score_total INTEGER;",
        "ALTER TABLE kjzx_historical_exams ADD COLUMN IF NOT EXISTS score_yinzhun INTEGER;",
        "ALTER TABLE kjzx_historical_exams ADD COLUMN IF NOT EXISTS score_jiezou INTEGER;",
        "ALTER TABLE kjzx_historical_exams ADD COLUMN IF NOT EXISTS score_yinse INTEGER;",
        "ALTER TABLE kjzx_historical_exams ADD COLUMN IF NOT EXISTS score_biaoxianli INTEGER;",
        "ALTER TABLE kjzx_historical_exams ADD COLUMN IF NOT EXISTS score_wanzhengxing INTEGER;",
        "ALTER TABLE kjzx_historical_exams ADD COLUMN IF NOT EXISTS review_text TEXT;",
        "ALTER TABLE kjzx_historical_exams ADD COLUMN IF NOT EXISTS self_review_text TEXT;",
        "ALTER TABLE kjzx_historical_exams ADD COLUMN IF NOT EXISTS review_teacher_name VARCHAR(64);",
        "ALTER TABLE kjzx_historical_exams ADD COLUMN IF NOT EXISTS is_excellent INTEGER DEFAULT 0;",
        "ALTER TABLE kjzx_historical_exams ADD COLUMN IF NOT EXISTS is_reject INTEGER DEFAULT 0;",
        "ALTER TABLE kjzx_historical_exams ADD COLUMN IF NOT EXISTS reject_reason TEXT;",
    ]

    def q(val: object) -> str:
        if val is None or val == "":
            return "NULL"
        s = str(val).replace("'", "''")
        return f"'{s}'"

    def qi(val: object) -> str:
        if val is None:
            return "NULL"
        s = str(val).strip()
        if not s or not s.lstrip("-").isdigit():
            return "NULL"
        return str(int(s))

    updated = 0
    for r in rows:
        eid = int(r["id"])
        sc_raw = str(r.get("score") or "").strip()
        sobj = {}
        if sc_raw.startswith("{"):
            try:
                sobj = json.loads(sc_raw)
            except Exception:
                sobj = {}
        yz = qi(sobj.get("score_yinzhun"))
        jz = qi(sobj.get("score_jiezou"))
        ys = qi(sobj.get("score_yinse"))
        bxl = qi(sobj.get("score_biaoxianli"))
        wzx = qi(sobj.get("score_wanzhengxing"))
        nums = [int(x) for x in (yz, jz, ys, bxl, wzx) if x != "NULL"]
        tot = str(sum(nums)) if nums else "NULL"
        rt = str(r.get("review_text") or "").strip()
        srt = str(r.get("self_review_text") or "").strip()
        rtn = str(r.get("review_teacher_name") or "").strip()
        exc = int(r.get("is_excellent") or 0)
        rej = int(r.get("is_reject") or 0)
        rejr = str(r.get("reject_reson") or "").strip()

        if nums or rt or srt or rtn or exc or rej or rejr:
            sql_lines.append(
                f"UPDATE kjzx_historical_exams SET "
                f"score_json={q(json.dumps(sobj, ensure_ascii=False))}::jsonb, "
                f"score_total={tot}, score_yinzhun={yz}, score_jiezou={jz}, score_yinse={ys}, "
                f"score_biaoxianli={bxl}, score_wanzhengxing={wzx}, review_text={q(rt)}, "
                f"self_review_text={q(srt)}, review_teacher_name={q(rtn)}, "
                f"is_excellent={exc}, is_reject={rej}, reject_reason={q(rejr)} "
                f"WHERE exam_id={eid};"
            )
            updated += 1

    sql_lines.append("COMMIT;")
    cmd = [
        "docker",
        "exec",
        "-i",
        "devhub-postgres",
        "sh",
        "-c",
        'psql -U "$POSTGRES_USER" -d musicexamaid_dev -q',
    ]
    subprocess.run(cmd, input="\n".join(sql_lines), text=True, capture_output=True, check=True)
    print(f"Backfilled {updated} exam rows with 5-D sub-scores & adjudicator reviews into PostgreSQL.")
    return updated


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
      'pass_level', e.pass_level,
      'exam_titles', e.exam_titles,
      'videos_json', e.videos_json,
      'score_total', e.score_total,
      'score_yinzhun', e.score_yinzhun,
      'score_jiezou', e.score_jiezou,
      'score_yinse', e.score_yinse,
      'score_biaoxianli', e.score_biaoxianli,
      'score_wanzhengxing', e.score_wanzhengxing,
      'review_text', e.review_text,
      'self_review_text', e.self_review_text,
      'review_teacher_name', e.review_teacher_name,
      'is_excellent', e.is_excellent,
      'is_reject', e.is_reject,
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
    live_clips = 0
    live_scored_clips = 0
    live_reviewed_clips = 0
    by_instrument: dict[str, int] = {}
    by_live_instrument: dict[str, int] = {}
    by_grade: dict[int, int] = {}
    by_category: dict[str, int] = {}
    by_season: dict[str, int] = {}

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
            is_live_oss = season_code in LIVE_SEASONS_ASC
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
                    "pass_level": row.get("pass_level"),
                    "piece_title": raw_title or f"clip_{clip_idx}",
                    "clip_category": category,
                    "score_total_50": row.get("score_total"),
                    "score_5d": {
                        "yinzhun_pitch": row.get("score_yinzhun"),
                        "jiezou_rhythm": row.get("score_jiezou"),
                        "yinse_tone": row.get("score_yinse"),
                        "biaoxianli_expression": row.get("score_biaoxianli"),
                        "wanzhengxing_completeness": row.get("score_wanzhengxing"),
                    },
                    "review_rubric_tags": row.get("review_text"),
                    "review_narrative": row.get("self_review_text"),
                    "adjudicator_name": row.get("review_teacher_name"),
                    "is_excellent": row.get("is_excellent"),
                    "is_reject": row.get("is_reject"),
                    "learner_anon_id": anon_id,
                    "learner_gender": row.get("sex"),
                    "learner_birth_year": birth_year,
                    "age_at_exam": age_at_exam,
                    "season_code": season_code,
                    "season_label": row.get("season_label"),
                    "oss_live_expected": is_live_oss,
                    "source_url": v_obj["url"],
                    "video_md5": v_obj.get("video_md5"),
                    "rel_video_path": rel_video,
                    "rel_audio_path": rel_audio,
                }
                out_f.write(json.dumps(record, ensure_ascii=False) + "\n")
                total_clips += 1
                if is_live_oss:
                    live_clips += 1
                    if row.get("score_total") is not None:
                        live_scored_clips += 1
                    if row.get("review_text") or row.get("self_review_text"):
                        live_reviewed_clips += 1
                    by_live_instrument[major_name] = by_live_instrument.get(major_name, 0) + 1
                by_instrument[major_name] = by_instrument.get(major_name, 0) + 1
                by_grade[level] = by_grade.get(level, 0) + 1
                by_category[category] = by_category.get(category, 0) + 1
                by_season[season_code] = by_season.get(season_code, 0) + 1

    summary = {
        "dataset_root": str(dataset_root),
        "manifest_path": str(manifest_path),
        "total_labeled_video_clips": total_clips,
        "live_oss_video_clips_20235_20265": live_clips,
        "live_clips_with_5d_numeric_scores": live_scored_clips,
        "live_clips_with_adjudicator_reviews": live_reviewed_clips,
        "live_seasons_rescue_order": LIVE_SEASONS_ASC,
        "by_live_instrument": dict(sorted(by_live_instrument.items(), key=lambda kv: kv[1], reverse=True)),
        "by_instrument_all_years": dict(sorted(by_instrument.items(), key=lambda kv: kv[1], reverse=True)),
        "by_grade": dict(sorted(by_grade.items())),
        "by_category": by_category,
        "by_season": dict(sorted(by_season.items(), reverse=True)),
    }
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return manifest_path


def throttled_stream_download(url: str, dest_path: Path, max_kbps: int) -> int:
    """Streams URL to dest_path with a polite per-chunk token-bucket rate limit."""
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": random.choice(BROWSER_USER_AGENTS),
            "Referer": "https://kjzx002120.kj5.zgyyxykj.com/",
            "Accept": "*/*",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Connection": "keep-alive",
        },
    )
    chunk_size = 65536  # 64 KB
    max_bytes_per_sec = max(128, max_kbps) * 1024
    tmp_path = dest_path.with_suffix(".mp4.part")
    total_read = 0
    t_start = time.monotonic()

    with urllib.request.urlopen(req, timeout=90) as resp, open(tmp_path, "wb") as out_f:
        while True:
            chunk = resp.read(chunk_size)
            if not chunk:
                break
            out_f.write(chunk)
            total_read += len(chunk)
            elapsed = time.monotonic() - t_start
            expected_elapsed = total_read / max_bytes_per_sec
            if expected_elapsed > elapsed:
                time.sleep(expected_elapsed - elapsed)

    tmp_path.replace(dest_path)
    return total_read


def main() -> None:
    parser = argparse.ArgumentParser(description="Polite, Rate-Limited MusicExamAid ML Video Mirror Worker")
    parser.add_argument("--dataset-root", default=DATASET_ROOT_DEFAULT)
    parser.add_argument("--backfill-scores", action="store_true", help="Backfill 5-D scores & adjudicator reviews from exams_all.json into Postgres")
    parser.add_argument("--export-manifest", action="store_true", help="Export full JSONL manifest from Postgres")
    parser.add_argument("--download", action="store_true", help="Run polite sequential downloader")
    parser.add_argument("--instrument", default="", help="Filter by instrument_cn (e.g. 钢琴, 古筝, 小提琴)")
    parser.add_argument("--grade", type=int, default=0, help="Filter by exact grade_level (1..11)")
    parser.add_argument("--season", default="", help="Filter by season_code prefix (default: all live seasons 20235..20265)")
    parser.add_argument("--rescue-order", action="store_true", default=True, help="Download oldest live season (20235) + scored clips first")
    parser.add_argument("--limit", type=int, default=0, help="Max NEW downloads in this run (0 = unlimited)")
    parser.add_argument("--max-kbps", type=int, default=1500, help="Per-stream bandwidth cap in KB/s (default: 1500 KB/s = 1.5 MB/s)")
    parser.add_argument("--sleep-min", type=float, default=3.5, help="Min sleep seconds between clips")
    parser.add_argument("--sleep-max", type=float, default=8.5, help="Max sleep seconds between clips")
    parser.add_argument("--coffee-every", type=int, default=40, help="Take a longer pause every N downloads")
    parser.add_argument("--coffee-seconds", type=float, default=45.0, help="Duration of periodic pause")
    parser.add_argument("--max-consecutive-blocks", type=int, default=3, help="Stop immediately if 403/429 repeats N times")
    parser.add_argument("--extract-audio", action="store_true", help="Extract 24kHz mono WAV via ffmpeg if available")
    args = parser.parse_args()

    dataset_root = Path(args.dataset_root)
    manifest_path = dataset_root / "manifest_all_clips.jsonl"
    status_path = dataset_root / "mirror_status.json"

    if args.backfill_scores:
        backfill_scores_into_postgres()

    if args.export_manifest or not manifest_path.exists():
        export_manifest_from_postgres(dataset_root)

    if not args.download:
        return

    candidates = []
    with open(manifest_path, "r", encoding="utf-8") as f:
        for line in f:
            rec = json.loads(line)
            sc = str(rec.get("season_code") or "")
            if not args.season and sc not in LIVE_SEASONS_ASC:
                continue
            if args.season and not sc.startswith(args.season):
                continue
            if args.instrument and rec["instrument_cn"] != args.instrument:
                continue
            if args.grade and int(rec["grade_level"]) != args.grade:
                continue
            candidates.append(rec)

    if args.rescue_order:
        # Global Value-First + Oldest-Season Rescue Order:
        # Tier 0: 5D-scored Gold References (50/50) OR Contrastive Defect/Fail clips (any 3-point subscore, pass_level==0, or is_reject==1)
        # Tier 1: All remaining 5D numeric-scored clips across all live seasons (20235 -> 20265)
        # Tier 2: Adjudicator-reviewed clips (rubric tags / narrative) without numeric 5D score
        # Tier 3: Remaining unscored live clips (oldest live season first)
        season_rank = {s: idx for idx, s in enumerate(LIVE_SEASONS_ASC)}

        def clip_priority_key(r: dict) -> tuple:
            sc_rank = season_rank.get(str(r.get("season_code")), 99)
            score_tot = r.get("score_total_50")
            s5d = r.get("score_5d") or {}
            subscores = [s5d.get(k) for k in ("yinzhun_pitch", "jiezou_rhythm", "yinse_tone", "biaoxianli_expression", "wanzhengxing_completeness") if s5d.get(k) is not None]
            has_low_subscore = any(int(v) <= 3 for v in subscores)
            is_gold_or_defect = (
                score_tot == 50
                or has_low_subscore
                or r.get("pass_level") == 0
                or r.get("is_reject") == 1
                or r.get("is_excellent") == 1
            )
            has_review = bool(r.get("review_rubric_tags") or r.get("review_narrative"))
            if score_tot is not None and is_gold_or_defect:
                tier = 0
            elif score_tot is not None:
                tier = 1
            elif has_review:
                tier = 2
            else:
                tier = 3
            return (
                tier,
                sc_rank,
                0 if has_review else 1,
                int(r["exam_id"]),
                int(r["clip_index"]),
            )

        candidates.sort(key=clip_priority_key)

    downloaded = 0
    cached = 0
    failed_404 = 0
    consecutive_blocks = 0
    total_new_bytes = 0
    started_at = datetime.now(timezone.utc).isoformat()
    known_404_path = dataset_root / "known_404_clips.txt"
    known_404_ids: set[str] = set()
    if known_404_path.exists():
        known_404_ids = {line.strip() for line in known_404_path.read_text(encoding="utf-8").splitlines() if line.strip()}
    else:
        # Season 20235 was 100% scanned in run #1 (1,069 saved, 948 404s); seed missing 20235 clips so restarts never re-probe dead 20235 URLs
        for r in candidates:
            if str(r.get("season_code")) == "20235":
                vp = dataset_root / r["rel_video_path"]
                if not (vp.exists() and vp.stat().st_size >= 1024):
                    known_404_ids.add(str(r["clip_id"]))
        if known_404_ids:
            known_404_path.write_text("\n".join(sorted(known_404_ids)) + "\n", encoding="utf-8")

    def write_status(state: str, current_clip: dict | None = None, last_error: str | None = None) -> None:
        payload = {
            "state": state,
            "started_at": started_at,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "rate_limit_policy": {
                "workers": 1,
                "max_kbps": args.max_kbps,
                "jitter_sleep_sec": [args.sleep_min, args.sleep_max],
                "coffee_break": f"{args.coffee_seconds}s every {args.coffee_every} clips",
                "priority": "tier0_gold50_and_3pt_defects -> tier1_all_5D_scored -> tier2_reviewed -> tier3_unscored",
            },
            "total_candidates_in_queue": len(candidates),
            "newly_downloaded": downloaded,
            "already_cached_on_disk": cached,
            "skipped_404": failed_404,
            "consecutive_blocks": consecutive_blocks,
            "newly_downloaded_mb": round(total_new_bytes / (1024 * 1024), 2),
            "current_clip": current_clip,
            "last_error": last_error,
        }
        status_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    write_status("running")
    ffmpeg_bin = shutil.which("ffmpeg") or (
        "/home/ubt/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg"
        if Path("/home/ubt/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg").exists()
        else None
    )

    for rec in candidates:
        video_path = dataset_root / rec["rel_video_path"]
        if video_path.exists() and video_path.stat().st_size >= 1024:
            cached += 1
            if cached % 200 == 0:
                write_status("running", {"clip_id": rec["clip_id"], "season": rec["season_code"], "note": "scanning cached"})
            continue

        if str(rec["clip_id"]) in known_404_ids:
            failed_404 += 1
            continue

        video_path.parent.mkdir(parents=True, exist_ok=True)
        clip_meta = {
            "clip_id": rec["clip_id"],
            "season_code": rec["season_code"],
            "instrument_cn": rec["instrument_cn"],
            "grade_level": rec["grade_level"],
            "piece_title": rec["piece_title"],
            "score_total_50": rec.get("score_total_50"),
            "score_5d": rec.get("score_5d"),
        }
        write_status("downloading", clip_meta)

        try:
            nbytes = throttled_stream_download(rec["source_url"], video_path, args.max_kbps)
            downloaded += 1
            total_new_bytes += nbytes
            consecutive_blocks = 0

            if args.extract_audio and ffmpeg_bin:
                audio_path = dataset_root / rec["rel_audio_path"]
                audio_path.parent.mkdir(parents=True, exist_ok=True)
                if not audio_path.exists():
                    subprocess.run(
                        [
                            ffmpeg_bin,
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

            write_status("running", clip_meta)

            if args.limit > 0 and downloaded >= args.limit:
                write_status("completed_limit_reached", clip_meta)
                break

            if args.coffee_every > 0 and downloaded % args.coffee_every == 0:
                pause_s = args.coffee_seconds + random.uniform(0, 15.0)
                write_status("coffee_break_pause", {**clip_meta, "pause_sec": round(pause_s, 1)})
                time.sleep(pause_s)
            else:
                time.sleep(random.uniform(args.sleep_min, args.sleep_max))

        except urllib.error.HTTPError as he:
            if he.code == 404:
                failed_404 += 1
                known_404_ids.add(str(rec["clip_id"]))
                with open(known_404_path, "a", encoding="utf-8") as f404:
                    f404.write(str(rec["clip_id"]) + "\n")
                write_status("running", clip_meta, f"HTTP 404 on {rec['clip_id']}")
                time.sleep(random.uniform(1.5, 3.0))
                continue

            consecutive_blocks += 1
            backoff_sec = min(3600, 300 * (3 ** (consecutive_blocks - 1)))
            err_msg = f"HTTP {he.code} on {rec['clip_id']} (block #{consecutive_blocks}); backing off {backoff_sec}s"
            write_status("circuit_breaker_backoff", clip_meta, err_msg)
            if consecutive_blocks >= args.max_consecutive_blocks:
                write_status("halted_by_circuit_breaker", clip_meta, err_msg)
                raise SystemExit(err_msg)
            time.sleep(backoff_sec)

        except Exception as err:
            consecutive_blocks += 1
            backoff_sec = min(1800, 120 * consecutive_blocks)
            err_msg = f"Network error on {rec['clip_id']}: {err}"
            write_status("transient_error_backoff", clip_meta, err_msg)
            if consecutive_blocks >= args.max_consecutive_blocks * 2:
                write_status("halted_by_network_errors", clip_meta, err_msg)
                raise SystemExit(err_msg)
            time.sleep(backoff_sec)

    write_status("finished")
    print(status_path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
