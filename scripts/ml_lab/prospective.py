"""Offline candidate freeze, score-blind enrollment and official-score calibration.

Run ``python -m scripts.ml_lab.prospective --help``. Individual artifacts stay
private. Freezing/enrollment never use incoming scores to choose participants.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
from urllib.parse import urlsplit

import joblib
import numpy as np
import scipy
from scipy.optimize import minimize_scalar
from scipy.special import softmax
import sklearn
from threadpoolctl import threadpool_limits

from .data import (DIMENSIONS, SCORE_LEVELS, digest, feature_dict, load_dataset,
                   new_output, provenance, read_jsonl, reserved_groups, stamp,
                   write_json, write_jsonl)
from .ordinal import OrdinalClassifier, exam_weights, metrics


VARIANTS = ("majority", "median", "context_only", "acoustic_only", "full")


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def object_hash(value) -> str:
    return digest(json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False))


def utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        raise ValueError("Cohort closing time needs an explicit timezone")
    return parsed.astimezone(timezone.utc)


@contextmanager
def state_lock(directory: Path):
    with (directory / ".workflow.lock").open("a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError("Another operation is using this cohort") from None
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def identities(row: dict) -> set[str]:
    """Stable identities, including unavailable/nonlive history and URL duplicates."""
    values = [f"exam:{row['season_code']}:{row['exam_id']}"]
    if row.get("learner_anon_id"):
        values.append("learner:" + str(row["learner_anon_id"]))
    md5 = str(row.get("video_md5") or "").strip()
    if md5:
        values.append("md5:" + md5)
    source = urlsplit(str(row.get("source_url") or ""))
    if source.netloc and source.path:
        values.append("url:" + source.netloc + source.path)
    return {digest(value) for value in values}


def load_protocol(directory: Path) -> dict:
    protocol = json.loads((directory / "protocol.json").read_text())
    expected = protocol["protocol_id"]
    if object_hash({k: v for k, v in protocol.items() if k != "protocol_id"}) != expected:
        raise ValueError("Frozen protocol changed")
    for name, expected_hash in protocol["files"].items():
        if file_hash(directory / name) != expected_hash:
            raise ValueError("Frozen candidate/history changed")
    return protocol


def validate_exam_metadata(rows: list[dict]) -> None:
    known = {}
    for row in rows:
        signature = tuple(row[k] for k in ("group", "family", "instrument", "grade"))
        if known.setdefault(row["exam_key"], signature) != signature:
            raise ValueError("Conflicting learner/family/grade metadata within an exam")


def freeze_candidate(root: Path, model_dir: Path, packet: Path, out: Path, *,
                     season: str, close_at: str, seed=42, min_groups=20,
                     min_class_exams=5, min_test_groups=5, threads=2,
                     extra_cache=None, rehearsal=False, now: datetime | None = None) -> dict:
    clock = now or datetime.now(timezone.utc)
    if len(season) != 5 or not season.isdigit() or (not rehearsal and utc(close_at) <= clock):
        raise ValueError("Choose an explicit five-digit season and a future cohort closing time")
    if min(min_groups, min_class_exams, min_test_groups, threads) < 1:
        raise ValueError("Positive group/class minimums and thread count required")
    # Trust only joblib artifacts produced locally by this lab; pickle is executable.
    bundle = joblib.load(model_dir / "models.joblib")
    if tuple(bundle["score_levels"]) != SCORE_LEVELS or not bundle["models"]:
        raise ValueError("Candidate must contain fitted four-level lab models")
    kind = bundle["report"]["kind"]
    names = {"offline_ordinal_trial": "training_snapshot.jsonl",
             "retrospective_forward_season_trial": "train_snapshot.jsonl"}
    if kind not in names:
        raise ValueError("Candidate needs a recognized training-only lab snapshot")
    snapshot_path = model_dir / names[kind]
    snapshot = read_jsonl(snapshot_path)
    validate_exam_metadata(snapshot)
    rows, audit = load_dataset(root, extra_cache, include_labels=False)
    current = {r["clip_key"]: r for r in rows}
    excluded = reserved_groups(rows, packet)
    if any(r["clip_key"] not in current or current[r["clip_key"]]["group"] in excluded for r in snapshot):
        raise ValueError("Training snapshot is absent from history or overlaps the teacher reservation")
    # Include every manifest row, even without usable media, scores or a live flag.
    history = set().union(*(identities(r) for r in read_jsonl(root / "manifest_all_clips.jsonl")))
    reservation = json.loads((packet / "reservation.json").read_text())
    history.update(digest("learner:" + str(value)) for value in reservation["learners"])
    history.update(digest("md5:" + str(value).strip()) for value in reservation["video_md5s"] if value)
    history = sorted(history)
    write_json(out / "history.json", history)
    shutil.copyfile(model_dir / "models.joblib", out / "candidate.joblib")
    baselines = {}
    with threadpool_limits(limits=threads):
        for key, model in sorted(bundle["models"].items()):
            family, dim = key.split(":", 1)
            if dim not in DIMENSIONS:
                raise ValueError("Unknown model dimension")
            subset = [r for r in snapshot if r["family"] == family and r["labels"][dim] is not None]
            if not subset:
                raise ValueError("Fitted candidate lacks matching labeled training rows")
            exam_labels = {}
            for row in subset:
                value = row["labels"][dim]
                if value not in SCORE_LEVELS or exam_labels.setdefault(row["exam_key"], value) != value:
                    raise ValueError("Invalid/conflicting training labels")
            y = np.array([SCORE_LEVELS.index(r["labels"][dim]) for r in subset])
            weights = exam_weights(subset)
            frequency = np.bincount(y, weights=weights, minlength=4)
            baselines[key] = {"majority": frequency / frequency.sum(),
                              "median": np.eye(4)[int(np.searchsorted(np.cumsum(frequency), frequency.sum() / 2))],
                              "train_class_counts": dict(Counter(exam_labels.values()))}
            for variant in ("context_only", "acoustic_only"):
                baselines[key][variant] = OrdinalClassifier(model.iterations, model.seed).fit(
                    [feature_dict(r, variant) for r in subset], y, weights)
    joblib.dump(baselines, out / "baselines.joblib")
    protocol = {"kind": "official_score_protocol", "created_at": stamp(),
                "mode": "retrospective_rehearsal" if rehearsal else "prospective",
                "season": season, "close_at": utc(close_at).isoformat(), "seed": seed,
                "historical_manifest_sha256": file_hash(root / "manifest_all_clips.jsonl"),
                "training_snapshot_sha256": file_hash(snapshot_path), "source_audit": audit,
                "files": {name: file_hash(out / name) for name in ("history.json", "candidate.joblib", "baselines.joblib")},
                "calibration": {"method": "temperature_scaling", "temperature_bounds": [0.05, 20.0],
                                "min_groups": min_groups, "min_class_exams": min_class_exams},
                "min_test_groups": min_test_groups, "threads": threads,
                "split": "SHA256(seed:group), first 64 bits < 2**63 -> calibration; otherwise heldout_test",
                "label_policy": "Exclude unknown values/all-zero vectors; retain mixed zero values; exam-level only",
                "versions": {"numpy": np.__version__, "scipy": scipy.__version__, "sklearn": sklearn.__version__},
                "code_provenance": provenance(sorted(Path(__file__).parent.glob("*.py"))),
                "production_ready": False}
    protocol["protocol_id"] = object_hash(protocol)
    write_json(out / "protocol.json", protocol)
    return {"status": "candidate_frozen", "models": len(bundle["models"]), "historical_identities": len(history),
            "close_at": protocol["close_at"], "production_ready": False}


def enroll(root: Path, frozen: Path, out: Path, *, extra_cache=None,
           manifest_path: Path | None = None, now: datetime | None = None) -> dict:
    protocol = load_protocol(frozen)
    if (now or datetime.now(timezone.utc)) < utc(protocol["close_at"]):
        raise ValueError("Cohort is still open; enroll once after its fixed closing time")
    manifest_path = manifest_path if manifest_path is not None else root / "manifest_all_clips.jsonl"
    if (protocol["mode"] == "prospective" and
            datetime.fromtimestamp(manifest_path.stat().st_mtime, timezone.utc) > utc(protocol["close_at"])):
        raise ValueError("Use a manifest snapshot captured by the fixed cohort closing time")
    with state_lock(frozen):
        if (frozen / "enrolled.json").exists():
            raise ValueError("This frozen candidate already has an enrolled cohort")
        rows, audit = load_dataset(root, extra_cache, include_labels=False, manifest_path=manifest_path)
        raw = read_jsonl(manifest_path)
        raw_by_clip = {f"{r['season_code']}:{r['clip_id']}": r for r in raw}
        seen = set(json.loads((frozen / "history.json").read_text()))
        # A group is old if ANY connected recording is old, including another season.
        old_groups = {r["group"] for r in rows if identities(raw_by_clip[r["clip_key"]]) & seen}
        selected = [r for r in rows if r["season"] == protocol["season"] and r["group"] not in old_groups]
        validate_exam_metadata(selected)
        membership, frozen_rows = {}, []
        for row in selected:
            subset = "calibration" if int(digest(f"{protocol['seed']}:{row['group']}")[:16], 16) < 2**63 else "heldout_test"
            membership[row["group"]] = subset
            frozen_rows.append({k: row[k] for k in ("sample_id", "clip_key", "exam_key", "group", "family", "instrument", "grade")})
            frozen_rows[-1]["subset"] = subset
        write_jsonl(out / "cohort.jsonl", sorted(frozen_rows, key=lambda r: r["clip_key"]))
        bundle = joblib.load(frozen / "candidate.joblib")
        baselines = joblib.load(frozen / "baselines.joblib")
        predictions = {"calibration": [], "heldout_test": []}
        with threadpool_limits(limits=protocol["threads"]):
            for key, model in sorted(bundle["models"].items()):
                family, dim = key.split(":", 1)
                available = [r for r in selected if r["family"] == family and r["audio_available"] and r["features"] is not None]
                if not available:
                    continue
                probabilities = {"full": model.predict_proba([feature_dict(r, "full") for r in available])}
                for variant in ("context_only", "acoustic_only"):
                    probabilities[variant] = baselines[key][variant].predict_proba([feature_dict(r, variant) for r in available])
                for variant in ("majority", "median"):
                    probabilities[variant] = np.tile(baselines[key][variant], (len(available), 1))
                by_exam = defaultdict(list)
                for i, row in enumerate(available):
                    by_exam[row["exam_key"]].append(i)
                for exam_key, indices in sorted(by_exam.items()):
                    group = available[indices[0]]["group"]
                    predictions[membership[group]].append({"exam_key": exam_key, "group": group,
                        "family": family, "dimension": dim, "clip_count": len(indices),
                        "model_probabilities": {v: probabilities[v][indices].mean(axis=0).tolist() for v in VARIANTS}})
        for subset, items in predictions.items():
            write_jsonl(out / f"{subset}_predictions.jsonl", items)
        files = {name: file_hash(out / name) for name in ("cohort.jsonl", "calibration_predictions.jsonl", "heldout_test_predictions.jsonl")}
        counts = {subset: {"groups": sum(v == subset for v in membership.values()),
                         "exams": len({r["exam_key"] for r in frozen_rows if r["subset"] == subset}),
                         "predicted_exams": len({r["exam_key"] for r in predictions[subset]}),
                         "predicted_dimension_rows": len(predictions[subset])} for subset in predictions}
        by_family = {family: {subset: {
            "groups": len({r["group"] for r in frozen_rows if r["family"] == family and r["subset"] == subset}),
            "exams": len({r["exam_key"] for r in frozen_rows if r["family"] == family and r["subset"] == subset}),
            "predicted_exams": len({r["exam_key"] for r in predictions[subset] if r["family"] == family})}
            for subset in predictions} for family in sorted({r["family"] for r in frozen_rows})}
        report = {"kind": "score_blind_enrollment", "created_at": stamp(),
                  "mode": protocol["mode"],
                  "protocol_id": protocol["protocol_id"], "files": files, "counts": counts, "by_family": by_family,
                  "source_audit": audit, "old_groups_excluded": len(old_groups), "production_ready": False,
                  "status": "enrolled" if selected else "no_unseen_groups",
                  "coverage": "Membership includes unavailable/unfeatured recordings; predictions use only audio with cached features at enrollment."}
        report["enrollment_id"] = object_hash(report)
        write_json(out / "enrollment.json", report)
        write_json(frozen / "enrolled.json", {"enrollment_id": report["enrollment_id"], "directory": str(out.resolve())})
        return {"status": report["status"], "counts": counts, "production_ready": False}


def load_enrollment(frozen: Path, enrolled: Path) -> tuple[dict, dict]:
    protocol = load_protocol(frozen)
    enrollment = json.loads((enrolled / "enrollment.json").read_text())
    marker = json.loads((frozen / "enrolled.json").read_text())
    if (enrollment["protocol_id"] != protocol["protocol_id"] or marker["enrollment_id"] != enrollment["enrollment_id"]
            or object_hash({k: v for k, v in enrollment.items() if k != "enrollment_id"}) != enrollment["enrollment_id"]):
        raise ValueError("Enrollment does not match the frozen protocol")
    for name, expected in enrollment["files"].items():
        if file_hash(enrolled / name) != expected:
            raise ValueError("Frozen cohort/predictions changed")
    return protocol, enrollment


def check_current_membership(root: Path, frozen: Path, enrolled: Path) -> None:
    """Reject identities corrected/merged across partitions after enrollment."""
    cohort = read_jsonl(enrolled / "cohort.jsonl")
    current, _ = load_dataset(root, include_labels=False)
    by_clip = {r["clip_key"]: r for r in current}
    raw = {f"{r['season_code']}:{r['clip_id']}": r for r in read_jsonl(root / "manifest_all_clips.jsonl")}
    history = set(json.loads((frozen / "history.json").read_text()))
    old_groups = {r["group"] for r in current if identities(raw[r["clip_key"]]) & history}
    subsets = {}
    for row in cohort:
        actual = by_clip.get(row["clip_key"])
        if actual is None or any(actual[k] != row[k] for k in ("exam_key", "family", "instrument", "grade")):
            raise ValueError("Enrolled exam identity/metadata changed")
        group = actual["group"]
        if group in old_groups or subsets.setdefault(group, row["subset"]) != row["subset"]:
            raise ValueError("Updated learner/video identities cross historical or calibration/test partitions")


def official_labels(root: Path, exams: set[str]) -> dict[str, dict]:
    """Inspect scores ONLY after checking membership in the requested partition."""
    result = {}
    for row in read_jsonl(root / "manifest_all_clips.jsonl"):
        key = f"{row['season_code']}:{row['exam_id']}"
        if key not in exams:
            continue
        scores = row.get("score_5d") or {}
        invalid = not isinstance(scores, dict) or any(v is not None and (isinstance(v, bool) or v not in SCORE_LEVELS) for v in scores.values())
        ambiguous = not invalid and all(scores.get(d) == 0 for d in DIMENSIONS)
        labels = {d: scores.get(d) if not invalid and not ambiguous else None for d in DIMENSIONS}
        if result.setdefault(key, labels) != labels:
            raise ValueError("Conflicting official labels within an enrolled exam")
    return result


def checked_probabilities(values) -> np.ndarray:
    p = np.asarray(values, dtype=float)
    if p.ndim != 2 or p.shape[1] != 4 or not np.isfinite(p).all() or (p < 0).any() or not np.allclose(p.sum(axis=1), 1):
        raise ValueError("Expected finite normalized four-level probabilities")
    return p


def temperature_scale(probabilities: np.ndarray, temperature: float) -> np.ndarray:
    p = checked_probabilities(probabilities)
    if not np.isfinite(temperature) or temperature <= 0:
        raise ValueError("Temperature must be positive and finite")
    log_p = np.full_like(p, -np.inf)
    np.log(p, out=log_p, where=p > 0)
    return softmax(log_p / temperature, axis=1)


def probability_metrics(y: np.ndarray, p: np.ndarray) -> dict:
    p = checked_probabilities(p)
    correct = np.argmax(p, axis=1) == y
    confidence = p.max(axis=1)
    bins = []
    bin_ids = np.minimum((confidence * 10).astype(int), 9)
    for i in range(10):
        included = bin_ids == i
        if included.any():
            bins.append({"lower": i / 10, "count": int(included.sum()),
                         "mean_confidence": float(confidence[included].mean()),
                         "accuracy": float(correct[included].mean())})
    return {**metrics(y, p), "negative_log_loss": float(-np.log(np.clip(p[np.arange(len(y)), y], 1e-15, 1)).mean()),
            "multiclass_brier_sum": float(np.square(p - np.eye(4)[y]).sum(axis=1).mean()),
            "confidence_bins": bins}


def calibrate_official(root: Path, frozen: Path, enrolled: Path, out: Path) -> dict:
    protocol, enrollment = load_enrollment(frozen, enrolled)
    with state_lock(enrolled):
        if (enrolled / "evaluated.json").exists():
            raise ValueError("Final test was already evaluated; use a new untouched cohort for further tuning")
        check_current_membership(root, frozen, enrolled)
        # Do not read held-out predictions or labels here. Integrity hashes above
        # contain no scores and only bind the frozen files to this enrollment.
        predictions = read_jsonl(enrolled / "calibration_predictions.jsonl")
        labels = official_labels(root, {p["exam_key"] for p in predictions})
        write_json(out / "calibration_labels.json", labels)
        cases = {}
        by_case = defaultdict(list)
        for row in predictions:
            if labels.get(row["exam_key"], {}).get(row["dimension"]) is not None:
                by_case[f"{row['family']}:{row['dimension']}"].append(row)
        config = protocol["calibration"]
        for key, rows in sorted(by_case.items()):
            y = np.array([SCORE_LEVELS.index(labels[r["exam_key"]][r["dimension"]]) for r in rows])
            p = checked_probabilities([r["model_probabilities"]["full"] for r in rows])
            counts = np.bincount(y, minlength=4)
            case = {"exams": len(y), "groups": len({r["group"] for r in rows}),
                    "class_counts": {str(level): int(counts[i]) for i, level in enumerate(SCORE_LEVELS)},
                    "missing_score_levels": [level for i, level in enumerate(SCORE_LEVELS) if counts[i] == 0]}
            if (case["groups"] < config["min_groups"] or (counts > 0).sum() < 2
                    or counts[counts > 0].min() < config["min_class_exams"]):
                cases[key] = {**case, "status": "insufficient_calibration_labels"}
                continue
            if (p[np.arange(len(y)), y] == 0).any():
                cases[key] = {**case, "status": "observed_class_has_zero_base_probability"}
                continue
            def loss(log_temperature):
                q = temperature_scale(p, float(np.exp(log_temperature)))
                return float(-np.log(np.clip(q[np.arange(len(y)), y], 1e-15, 1)).mean())
            bounds = np.log(config["temperature_bounds"])
            fit = minimize_scalar(loss, bounds=bounds, method="bounded")
            if not fit.success or not np.isfinite(fit.fun):
                raise ValueError("Temperature optimization failed")
            temperature = float(np.exp(fit.x)) if fit.fun < loss(0.0) else 1.0
            cases[key] = {**case, "status": "fitted", "temperature": temperature,
                          "uncalibrated": probability_metrics(y, p),
                          "calibrated": probability_metrics(y, temperature_scale(p, temperature))}
        result = {"kind": "official_score_temperature_calibration", "created_at": stamp(),
                  "mode": protocol["mode"], "enrollment_counts": enrollment["counts"]["calibration"],
                  "labeled_exams": sum(any(v is not None for v in d.values()) for d in labels.values()),
                  "protocol_id": protocol["protocol_id"], "enrollment_id": enrollment["enrollment_id"],
                  "label_snapshot_sha256": file_hash(out / "calibration_labels.json"), "cases": cases,
                  "status": "fitted" if any(c["status"] == "fitted" for c in cases.values()) else "awaiting_usable_calibration_labels",
                  "production_ready": False,
                  "limits": "Temperature changes confidence, preserves argmax and exact zero support; it cannot repair class recognition or validate recording quality."}
        write_json(out / "calibrator.json", result)
        return {"status": result["status"], "fitted_cases": sum(c["status"] == "fitted" for c in cases.values()), "production_ready": False}


def evaluate_official(root: Path, frozen: Path, enrolled: Path, calibration: Path, out: Path) -> dict:
    protocol, enrollment = load_enrollment(frozen, enrolled)
    adjustment = json.loads((calibration / "calibrator.json").read_text())
    if (adjustment["protocol_id"] != protocol["protocol_id"] or adjustment["enrollment_id"] != enrollment["enrollment_id"]
            or adjustment["label_snapshot_sha256"] != file_hash(calibration / "calibration_labels.json")
            or adjustment["status"] != "fitted"):
        raise ValueError("Need a fitted calibrator from this frozen cohort")
    with state_lock(enrolled):
        if (enrolled / "evaluated.json").exists():
            raise ValueError("Final test already evaluated; re-use its saved report")
        check_current_membership(root, frozen, enrolled)
        predictions = read_jsonl(enrolled / "heldout_test_predictions.jsonl")
        labels = official_labels(root, {p["exam_key"] for p in predictions})
        write_json(out / "test_labels.json", labels)
        by_case = defaultdict(list)
        for row in predictions:
            if labels.get(row["exam_key"], {}).get(row["dimension"]) is not None:
                by_case[f"{row['family']}:{row['dimension']}"].append(row)
        cases, saved = {}, []
        for key, rows in sorted(by_case.items()):
            groups = len({r["group"] for r in rows})
            if groups < protocol["min_test_groups"]:
                cases[key] = {"status": "insufficient_test_groups", "groups": groups, "exams": len(rows)}
                continue
            y = np.array([SCORE_LEVELS.index(labels[r["exam_key"]][r["dimension"]]) for r in rows])
            p = {v: checked_probabilities([r["model_probabilities"][v] for r in rows]) for v in VARIANTS}
            case = adjustment["cases"].get(key, {})
            if case.get("status") == "fitted":
                p["calibrated_full"] = temperature_scale(p["full"], case["temperature"])
            cases[key] = {"status": "evaluated", "groups": groups, "exams": len(rows),
                          "calibration_status": case.get("status", "no_calibration_labels"),
                          "models": {v: probability_metrics(y, value) for v, value in p.items()}}
            for i, row in enumerate(rows):
                saved.append({**row, "actual_native_score": SCORE_LEVELS[int(y[i])],
                              "model_probabilities": {v: value[i].tolist() for v, value in p.items()}})
        report = {"kind": "official_score_test", "mode": protocol["mode"], "created_at": stamp(),
                  "protocol_id": protocol["protocol_id"], "enrollment_id": enrollment["enrollment_id"],
                  "calibrator_sha256": file_hash(calibration / "calibrator.json"),
                  "enrollment_counts": enrollment["counts"], "cases": cases,
                  "labeled_test_exams": sum(any(v is not None for v in d.values()) for d in labels.values()),
                  "evaluated_exams": len({r["exam_key"] for r in saved}), "production_ready": False,
                  "status": "evaluated" if saved else "awaiting_usable_test_labels",
                  "limits": "Selected cohort with available cached audio; report missing labels/classes. No recording-quality, named-rating or population-accuracy claim."}
        write_jsonl(out / "test_predictions.jsonl", saved)
        write_json(out / "test_report.json", report)
        if saved:
            write_json(enrolled / "evaluated.json", {"directory": str(out.resolve()), "report_sha256": file_hash(out / "test_report.json")})
        return {"status": report["status"], "evaluated_exams": report["evaluated_exams"], "production_ready": False}


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["freeze", "enroll", "calibrate", "evaluate"])
    parser.add_argument("--dataset-root", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True, help="New private output directory")
    parser.add_argument("--model-dir", type=Path, help="Trusted lab trial directory containing models.joblib and training snapshot")
    parser.add_argument("--packet", type=Path)
    parser.add_argument("--season")
    parser.add_argument("--close-at", help="Fixed enrollment closing timestamp, with timezone")
    parser.add_argument("--frozen", type=Path)
    parser.add_argument("--enrolled", type=Path)
    parser.add_argument("--calibration", type=Path)
    parser.add_argument("--extra-cache", type=Path, action="append")
    parser.add_argument("--intake-manifest", type=Path, help="enroll only: snapshot captured before the fixed closing time")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--min-groups", type=int, default=20)
    parser.add_argument("--min-class-exams", type=int, default=5)
    parser.add_argument("--min-test-groups", type=int, default=5)
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--rehearsal", action="store_true", help="freeze only: mark historical practice as retrospective throughout")
    args = parser.parse_args()
    required = {"freeze": ("model_dir", "packet", "season", "close_at"), "enroll": ("frozen",),
                "calibrate": ("frozen", "enrolled"), "evaluate": ("frozen", "enrolled", "calibration")}
    for field in required[args.command]:
        if not getattr(args, field):
            parser.error(f"{args.command} requires --{field.replace('_', '-')}")
    if min(args.min_groups, args.min_class_exams, args.min_test_groups, args.threads) < 1:
        parser.error("Positive group/class minimums and thread count required")
    if args.rehearsal and args.command != "freeze":
        parser.error("--rehearsal applies only to freeze; later steps inherit its mode")
    if args.intake_manifest and args.command != "enroll":
        parser.error("--intake-manifest applies only to enroll")
    if args.command == "freeze" and (len(args.season) != 5 or not args.season.isdigit() or (not args.rehearsal and utc(args.close_at) <= datetime.now(timezone.utc))):
        parser.error("Choose a five-digit season and a future closing timestamp")
    out = new_output(args.dataset_root, args.out)
    write_json(out / "run_status.json", {"state": "running", "command": args.command, "started_at": stamp()})
    try:
        if args.command == "freeze":
            result = freeze_candidate(args.dataset_root, args.model_dir, args.packet, out, season=args.season,
                close_at=args.close_at, seed=args.seed, min_groups=args.min_groups, min_class_exams=args.min_class_exams,
                min_test_groups=args.min_test_groups, threads=args.threads, extra_cache=args.extra_cache,
                rehearsal=args.rehearsal)
        elif args.command == "enroll":
            result = enroll(args.dataset_root, args.frozen, out, extra_cache=args.extra_cache,
                            manifest_path=args.intake_manifest)
        elif args.command == "calibrate":
            result = calibrate_official(args.dataset_root, args.frozen, args.enrolled, out)
        else:
            result = evaluate_official(args.dataset_root, args.frozen, args.enrolled, args.calibration, out)
        write_json(out / "run_status.json", {"state": "completed", "command": args.command, "completed_at": stamp()})
        print(json.dumps(result))
    except Exception as error:
        write_json(out / "run_status.json", {"state": "failed", "command": args.command, "error_type": type(error).__name__})
        raise


if __name__ == "__main__":
    main()
