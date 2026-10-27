"""Usage: python -m scripts.ml_lab --help"""
from __future__ import annotations

import argparse
import json
import os
import wave
from pathlib import Path

from .calibration import calibrate_gate, make_packet, validate_labels
from .data import (digest, load_dataset, media_path, new_output, provenance,
                   read_jsonl, reserved_groups, stamp, write_json, write_jsonl)
from .ordinal import predict_rows, run_trial


def extract_features(root: Path, rows: list[dict], out: Path, limit: int, seed: int,
                     sample_ids: set[str] | None = None, *, labeled_only: bool = False) -> dict:
    from scripts.yushen_acoustic_5d_pipeline import analyze_single_wav
    candidates = [r for r in rows if r["audio_available"] and r["features"] is None
                  and (not labeled_only or any(v is not None for v in r["labels"].values()))
                  and (sample_ids is None or r["sample_id"] in sample_ids)]
    candidates.sort(key=lambda r: digest(f"{seed}:{r['sample_id']}"))
    extracted, failed = [], 0
    for row in candidates[:limit]:
        path = media_path(root, row["rel_audio_path"], "audio_24k")
        # ffmpeg writes WAVs in place. Avoid analyzing a file whose header still
        # advertises an unfinished payload while the mirror is extracting it.
        try:
            with wave.open(str(path), "rb") as wav:
                payload_size = wav.getnframes() * wav.getsampwidth() * wav.getnchannels()
                if payload_size <= 0 or path.stat().st_size < payload_size + 44:
                    failed += 1
                    continue
            result = analyze_single_wav(path, row["grade"])
        except (OSError, EOFError, ValueError, wave.Error):
            result = None
        if result is None:
            failed += 1
            continue
        season, cid = row["clip_key"].split(":", 1)
        extracted.append({"clip_id": cid, "season_code": season, "features": result["features"]})
        # Atomic checkpoints make an interrupted bounded extraction reusable.
        write_jsonl(out / "features.jsonl", extracted)
        if len(extracted) % 10 == 0:
            print(json.dumps({"new_features": len(extracted), "failed": failed}), flush=True)
    if not extracted:
        write_jsonl(out / "features.jsonl", [])
    summary = {"created_at": stamp(), "requested_limit": limit, "new_feature_clips": len(extracted),
               "failed_clips": failed, "remaining_uncached_audio_at_start": len(candidates),
               "labeled_only": labeled_only,
               "extractor": provenance([Path(__file__).parents[1] / "yushen_acoustic_5d_pipeline.py"])}
    write_json(out / "extraction_report.json", summary)
    return summary


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description="Private, offline ML trials and teacher calibration preparation")
    parser.add_argument("command", choices=["audit", "packet", "extract", "trial", "validate-labels", "calibrate", "predict"])
    parser.add_argument("--dataset-root", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True, help="New private experiment directory; must not exist")
    parser.add_argument("--extra-cache", type=Path, action="append", help="Additional immutable cache; repeat for incremental batches")
    parser.add_argument("--packet", type=Path, help="Fixed teacher packet whose learner groups must stay out of training")
    parser.add_argument("--labels", type=Path)
    parser.add_argument("--model", type=Path, help="Trusted models.joblib produced by this package")
    parser.add_argument("--size", type=int, default=200)
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--labeled-only", action="store_true",
                        help="extract only clips with at least one usable historical dimension label")
    parser.add_argument("--max-groups-per-family", type=int, default=150, help="0 selects all groups")
    parser.add_argument("--min-groups", type=int, default=20)
    parser.add_argument("--folds", type=int, default=3)
    parser.add_argument("--iterations", type=int, default=60)
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    if min(args.limit, args.size, args.iterations, args.threads, args.min_groups) < 1 or args.folds < 2:
        parser.error("Positive limits, size, iterations, threads and group minimum required; folds >= 2")
    if args.max_groups_per_family < 0:
        parser.error("max-groups-per-family must be nonnegative")
    if args.labeled_only and args.command != "extract":
        parser.error("--labeled-only applies only to extract")
    if args.command in ["trial", "validate-labels", "calibrate"] and not args.packet:
        parser.error("--packet is required to preserve the teacher holdout")
    if args.command in ["validate-labels", "calibrate"] and not args.labels:
        parser.error("--labels is required")
    if args.command == "predict" and not args.model:
        parser.error("--model is required")
    out = new_output(args.dataset_root, args.out)
    write_json(out / "run_status.json", {"state": "running", "started_at": stamp(), "command": args.command})
    try:
        rows, audit = load_dataset(args.dataset_root, args.extra_cache)
        write_json(out / "data_audit.json", audit)
        write_json(out / "code_provenance.json", provenance(sorted(Path(__file__).parent.glob("*.py"))))
        if args.command == "audit":
            result = audit
        elif args.command == "packet":
            result = make_packet(rows, out, args.size, args.seed)
        elif args.command == "extract":
            sample_ids = {r["sample_id"] for r in read_jsonl(args.packet / "items.jsonl")} if args.packet else None
            result = extract_features(args.dataset_root, rows, out, args.limit, args.seed, sample_ids,
                                      labeled_only=args.labeled_only)
        elif args.command == "trial":
            result = run_trial(rows, reserved_groups(rows, args.packet), out,
                               folds=args.folds, max_groups=args.max_groups_per_family,
                               min_groups=args.min_groups, iterations=args.iterations,
                               seed=args.seed, threads=args.threads)
        elif args.command in ["validate-labels", "calibrate"]:
            labeled, result = validate_labels(args.packet, args.labels)
            write_json(out / "label_validation.json", result)
            write_jsonl(out / "validated_labels.jsonl", labeled)
            if args.command == "calibrate":
                result = calibrate_gate(rows, labeled, out)
        else:
            sample_ids = {r["sample_id"] for r in read_jsonl(args.packet / "items.jsonl")} if args.packet else None
            available = [r for r in rows if r["audio_available"] and r["features"] and
                         (sample_ids is None or r["sample_id"] in sample_ids)]
            result = {"feature_clips": len(available), "predicted_dimension_rows": predict_rows(args.model,
                available, out / "predictions.jsonl", args.threads)}
        write_json(out / "run_status.json", {"state": "completed", "completed_at": stamp(),
                                            "command": args.command})
        # Trial details may contain local pseudonymous identifiers: print only aggregate progress.
        if args.command == "trial":
            print(json.dumps({"out": str(out), "families": len(result["families"]), "production_ready": False}))
        else:
            print(json.dumps(result, ensure_ascii=False, indent=2))
    except Exception as error:
        write_json(out / "run_status.json", {"state": "failed", "failed_at": stamp(),
                                            "command": args.command, "error_type": type(error).__name__})
        raise


if __name__ == "__main__":
    main()
