"""Retrospective forward-season validation with learner/duplicate-group purging."""
from __future__ import annotations

from pathlib import Path
import platform

import joblib
import numpy as np
import scipy
import sklearn
from threadpoolctl import threadpool_limits

from .data import DIMENSIONS, SCORE_LEVELS, feature_dict, stamp, write_json, write_jsonl
from .ordinal import OrdinalClassifier, aggregate_exams, exam_weights, metrics


def split_seasons(rows: list[dict], excluded: set[str], test_season: str):
    if test_season not in {r["season"] for r in rows}:
        raise ValueError("Requested test season is absent from the manifest")
    # Include unlabeled/unavailable recordings in the purge. Group identities were
    # connected across the complete manifest before any availability/label filter.
    test_groups = {r["group"] for r in rows if r["season"] == test_season}
    eligible = [r for r in rows if r["family"] != "other" and r["audio_available"]
                and r["features"] is not None and r["group"] not in excluded
                and any(v is not None for v in r["labels"].values())]
    historical = [r for r in eligible if r["season"] < test_season]
    train = [r for r in historical if r["group"] not in test_groups]
    test = [r for r in eligible if r["season"] == test_season]
    if not train or not test:
        raise ValueError("Need labeled historical training and requested-season test clips after purging")
    if {r["group"] for r in train} & {r["group"] for r in test}:
        raise AssertionError("Learner/duplicate group crossed the temporal boundary")
    if {r["exam_key"] for r in train} & {r["exam_key"] for r in test}:
        raise AssertionError("Exam crossed the temporal boundary")
    counts = {"historical_clips_before_purge": len(historical),
              "purged_historical_clips": len(historical) - len(train),
              "all_test_season_groups": len(test_groups),
              "train_clips": len(train), "test_clips": len(test),
              "train_exams": len({r["exam_key"] for r in train}),
              "test_exams": len({r["exam_key"] for r in test}),
              "train_groups": len({r["group"] for r in train}),
              "test_groups": len({r["group"] for r in test})}
    return sorted(train, key=lambda r: r["clip_key"]), sorted(test, key=lambda r: r["clip_key"]), counts


def run_forward_trial(rows: list[dict], excluded: set[str], out: Path, *, test_season: str,
                      min_groups=20, min_test_groups=5, iterations=100, seed=42, threads=2):
    train, test, counts = split_seasons(rows, excluded, test_season)
    keys = ("sample_id", "clip_key", "exam_key", "group", "family", "instrument", "grade", "season", "features", "labels")
    for name, subset in [("train", train), ("test", test)]:
        write_jsonl(out / f"{name}_snapshot.jsonl", [{k: r[k] for k in keys} for r in subset])
    report = {"created_at": stamp(), "kind": "retrospective_forward_season_trial",
              "production_ready": False, "native_score_levels": SCORE_LEVELS,
              "named_rating_mapping": "not verified", "reserved_group_count": len(excluded),
              "split": counts, "config": {"test_season": test_season, "iterations": iterations,
              "min_train_groups": min_groups, "min_test_groups": min_test_groups, "seed": seed, "threads": threads},
              "metric_unit": "exam (clip probabilities averaged; each exam counted once)",
              "train_weighting": "equal total weight per exam", "families": {},
              "versions": {"python": platform.python_version(), "numpy": np.__version__,
                           "scipy": scipy.__version__, "sklearn": sklearn.__version__},
              "warnings": ["Retrospective check: this archive was already used for grouped CV, not a new untouched final test.",
                           "Train only on earlier seasons; purge every group seen in the test season, even without labels/features.",
                           "Teacher-review groups remain excluded from both partitions.",
                           "Historical examiner labels are per exam; zero semantics and named-rating mapping remain unverified.",
                           "A partially labeled latest season is a selected population; rare/missing classes limit conclusions.",
                           "Legacy acoustic features cover at most the first 210 seconds; no timestamp or multimodal-gate validation."]}
    write_json(out / "trial_report.json", report)
    bundle, predictions = {}, []
    with threadpool_limits(limits=threads):
        for family in sorted({r["family"] for r in train + test}):
            cases = {}
            for dim in DIMENSIONS:
                a = [r for r in train if r["family"] == family and r["labels"][dim] is not None]
                b = [r for r in test if r["family"] == family and r["labels"][dim] is not None]
                na, nb = len({r["group"] for r in a}), len({r["group"] for r in b})
                case = {"train_groups": na, "test_groups": nb,
                        "train_exams": len({r["exam_key"] for r in a}), "test_exams": len({r["exam_key"] for r in b})}
                if na < min_groups or nb < min_test_groups or len({r["labels"][dim] for r in a}) < 2:
                    cases[dim] = {**case, "status": "insufficient_data"}
                    continue
                ya = np.array([SCORE_LEVELS.index(r["labels"][dim]) for r in a])
                yb = np.array([SCORE_LEVELS.index(r["labels"][dim]) for r in b])
                weights = exam_weights(a)
                frequency = np.bincount(ya, weights=weights, minlength=4)
                results, clip_probs = {}, {}
                for variant in ["majority", "median", "context_only", "acoustic_only", "full"]:
                    if variant == "majority":
                        probabilities = np.tile(frequency / frequency.sum(), (len(b), 1))
                    elif variant == "median":
                        predicted = int(np.searchsorted(np.cumsum(frequency), frequency.sum() / 2))
                        probabilities = np.tile(np.eye(4)[predicted], (len(b), 1))
                    else:
                        model = OrdinalClassifier(iterations, seed).fit([feature_dict(r, variant) for r in a], ya, weights)
                        probabilities = model.predict_proba([feature_dict(r, variant) for r in b])
                        if variant == "full":
                            bundle[f"{family}:{dim}"] = model
                    ey, ep, _ = aggregate_exams(b, yb, probabilities)
                    results[variant] = metrics(ey, ep)
                    clip_probs[variant] = probabilities
                cases[dim] = {**case, "status": "evaluated", "models": results,
                              "train_class_counts": {str(level): len({r["exam_key"] for r in a if r["labels"][dim] == level}) for level in SCORE_LEVELS},
                              "missing_train_score_levels": [level for level in SCORE_LEVELS if not any(r["labels"][dim] == level for r in a)],
                              "missing_test_score_levels": [level for level in SCORE_LEVELS if not any(r["labels"][dim] == level for r in b)],
                              "beats_all_three_baselines_rank_mae": results["full"]["rank_mae"] < min(results[k]["rank_mae"] for k in ["majority", "median", "context_only"])}
                for i, row in enumerate(b):
                    predictions.append({"sample_id": row["sample_id"], "exam_key": row["exam_key"],
                                        "group": row["group"], "family": family, "dimension": dim,
                                        "actual_native_score": row["labels"][dim],
                                        "model_probabilities": {k: p[i].tolist() for k, p in clip_probs.items()}})
                print(f"{family}:{dim}: {len(a)} train clips, {len(b)} test clips", flush=True)
            report["families"][family] = cases
            write_json(out / "trial_report.json", report)
            write_jsonl(out / "test_predictions.jsonl", predictions)
    joblib.dump({"models": bundle, "score_levels": SCORE_LEVELS, "report": report}, out / "models.joblib")
    return report
