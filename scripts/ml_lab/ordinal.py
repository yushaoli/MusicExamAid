"""Four-level cumulative ordinal models with learner-disjoint evaluation."""
from __future__ import annotations

from collections import Counter, defaultdict
import json
from pathlib import Path
import platform

import joblib
import numpy as np
import scipy
import sklearn
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.feature_extraction import DictVectorizer
from sklearn.metrics import accuracy_score, cohen_kappa_score, confusion_matrix, f1_score
from sklearn.model_selection import StratifiedGroupKFold
from threadpoolctl import threadpool_limits

from .data import DIMENSIONS, SCORE_LEVELS, digest, feature_dict, stamp, write_json, write_jsonl


class OrdinalClassifier:
    """Fit P(rank > k) for each threshold; missing classes never get invented labels."""
    def __init__(self, iterations: int = 60, seed: int = 42):
        self.iterations, self.seed = iterations, seed
        self.vectorizer = DictVectorizer(sparse=False)
        self.thresholds = []

    def fit(self, features: list[dict], y: np.ndarray, weights: np.ndarray):
        x = self.vectorizer.fit_transform(features)
        self.thresholds = []
        for k in range(len(SCORE_LEVELS) - 1):
            target = (y > k).astype(int)
            if len(np.unique(target)) == 1:
                self.thresholds.append(float(target[0]))
            else:
                model = HistGradientBoostingClassifier(
                    max_iter=self.iterations, max_leaf_nodes=7, min_samples_leaf=15,
                    l2_regularization=5.0, early_stopping=False, random_state=self.seed,
                )
                model.fit(x, target, sample_weight=weights)
                self.thresholds.append(model)
        return self

    def predict_proba(self, features: list[dict]) -> np.ndarray:
        x = self.vectorizer.transform(features)
        cumulative = np.column_stack([
            np.full(len(features), model) if isinstance(model, float)
            else model.predict_proba(x)[:, 1] for model in self.thresholds
        ])
        # Threshold fits can cross. Clip to a nonincreasing cumulative distribution.
        cumulative = np.minimum.accumulate(np.clip(cumulative, 0, 1), axis=1)
        return np.diff(np.column_stack([np.ones(len(x)), cumulative, np.zeros(len(x))]), axis=1) * -1


def exam_weights(rows: list[dict]) -> np.ndarray:
    counts = Counter(r["exam_key"] for r in rows)
    weights = np.array([1 / counts[r["exam_key"]] for r in rows], dtype=float)
    return weights * len(weights) / weights.sum()


def aggregate_exams(rows: list[dict], y: np.ndarray, probabilities: np.ndarray):
    by_exam = defaultdict(list)
    for i, r in enumerate(rows):
        by_exam[r["exam_key"]].append(i)
    truth, probs, keys = [], [], []
    for key, indices in sorted(by_exam.items()):
        if len(set(y[indices])) != 1:
            raise ValueError("Conflicting official labels within an exam")
        truth.append(y[indices[0]])
        probs.append(probabilities[indices].mean(axis=0))
        keys.append(key)
    return np.asarray(truth), np.asarray(probs), keys


def metrics(y: np.ndarray, p: np.ndarray) -> dict:
    predicted = np.argmax(p, axis=1)
    kappa = cohen_kappa_score(y, predicted, labels=list(range(4)), weights="quadratic")
    return {"exam_count": len(y), "accuracy": round(float(accuracy_score(y, predicted)), 4),
            "macro_f1_four_levels": round(float(f1_score(y, predicted, labels=list(range(4)),
                                                        average="macro", zero_division=0)), 4),
            "rank_mae": round(float(np.mean(np.abs(y - predicted))), 4),
            "native_score_mae": round(float(np.mean(np.abs(np.asarray(SCORE_LEVELS)[y] -
                                                           np.asarray(SCORE_LEVELS)[predicted]))), 4),
            "quadratic_kappa": round(float(kappa), 4) if np.isfinite(kappa) else None,
            "class_counts": {str(SCORE_LEVELS[k]): int((y == k).sum()) for k in range(4)},
            "confusion_matrix": confusion_matrix(y, predicted, labels=list(range(4))).tolist()}


def choose_training_rows(rows: list[dict], excluded_groups: set[str], max_groups: int, seed: int):
    by_family = defaultdict(list)
    for row in rows:
        if row["family"] != "other" and row["audio_available"] and row["features"] and row["group"] not in excluded_groups:
            by_family[row["family"]].append(row)
    selected = []
    for family, subset in sorted(by_family.items()):
        groups = sorted({r["group"] for r in subset}, key=lambda g: digest(f"{seed}:{g}"))
        chosen = set(groups[:max_groups] if max_groups else groups)
        selected.extend(r for r in subset if r["group"] in chosen)
    return sorted(selected, key=lambda r: r["clip_key"])


def run_trial(rows: list[dict], excluded_groups: set[str], out: Path, *, folds=3,
              max_groups=150, min_groups=20, iterations=60, seed=42, threads=2) -> dict:
    rows = choose_training_rows(rows, excluded_groups, max_groups, seed)
    if not rows:
        raise ValueError("No cached feature rows are available outside the reserved groups")
    snapshot = [{k: r[k] for k in ("sample_id", "clip_key", "exam_key", "group", "family",
                                  "instrument", "grade", "features", "labels")} for r in rows]
    write_jsonl(out / "training_snapshot.jsonl", snapshot)
    report = {"created_at": stamp(), "kind": "offline_ordinal_trial", "production_ready": False,
              "native_score_levels": SCORE_LEVELS, "named_rating_mapping": "not verified",
              "grouping": "learner plus duplicate-video connected component",
              "metric_unit": "exam (clip probabilities averaged; each exam counted once)",
              "train_weighting": "equal total weight per exam", "reserved_group_count": len(excluded_groups),
              "selected_feature_clips": len(rows), "config": dict(folds=folds, max_groups=max_groups,
              min_groups=min_groups, iterations=iterations, seed=seed, threads=threads),
              "versions": {"python": platform.python_version(), "numpy": np.__version__,
                           "scipy": scipy.__version__, "sklearn": sklearn.__version__},
              "families": {}, "warnings": [
                  "Historical labels are per exam, not per clip or timestamp.",
                  "Cached audio and scored-first downloads are a selected population; this is not a population accuracy estimate.",
                  "All-zero score vectors are excluded as ambiguous, pending teacher confirmation.",
                  "Four score levels are numeric; their mapping to named teacher ratings is unverified.",
                  "No calibration labels or untouched final test results are available yet.",
                  "Legacy acoustic features inspect at most the first 210 seconds; timestamps are not validated.",
              ]}
    bundle, predictions = {}, []
    with threadpool_limits(limits=threads):
        for family in sorted({r["family"] for r in rows}):
            family_report = {}
            for dim in DIMENSIONS:
                subset = [r for r in rows if r["family"] == family and r["labels"][dim] is not None]
                n_groups = len({r["group"] for r in subset})
                if n_groups < max(min_groups, folds) or len({r["labels"][dim] for r in subset}) < 2:
                    family_report[dim] = {"status": "insufficient_data", "learner_groups": n_groups}
                    continue
                y = np.array([SCORE_LEVELS.index(r["labels"][dim]) for r in subset])
                groups = np.array([r["group"] for r in subset])
                split = StratifiedGroupKFold(n_splits=folds, shuffle=True, random_state=seed)
                splits = list(split.split(np.zeros((len(y), 1)), y, groups))
                fold_ids = np.full(len(y), -1)
                results = {}
                for variant in ["majority", "median", "context_only", "acoustic_only", "full"]:
                    probabilities = np.zeros((len(y), 4))
                    feature_rows = [feature_dict(r, variant) for r in subset]
                    for fold, (train, validation) in enumerate(splits):
                        if set(groups[train]) & set(groups[validation]):
                            raise AssertionError("Learner leakage in validation split")
                        train_rows = [subset[i] for i in train]
                        weights = exam_weights(train_rows)
                        if variant in ["majority", "median"]:
                            counts = np.bincount(y[train], weights=weights, minlength=4)
                            if variant == "median":
                                probabilities[validation, int(np.searchsorted(np.cumsum(counts), counts.sum() / 2))] = 1
                            else:
                                probabilities[validation] = counts / counts.sum()
                        else:
                            model = OrdinalClassifier(iterations, seed).fit(
                                [feature_rows[i] for i in train], y[train], weights)
                            probabilities[validation] = model.predict_proba([feature_rows[i] for i in validation])
                        fold_ids[validation] = fold
                    exam_y, exam_probs, _ = aggregate_exams(subset, y, probabilities)
                    results[variant] = metrics(exam_y, exam_probs)
                    if variant == "full":
                        bundle[f"{family}:{dim}"] = OrdinalClassifier(iterations, seed).fit(
                            feature_rows, y, exam_weights(subset))
                        for i, row in enumerate(subset):
                            predictions.append({"sample_id": row["sample_id"], "exam_key": row["exam_key"],
                                                "group": row["group"], "family": family, "dimension": dim,
                                                "fold": int(fold_ids[i]), "actual_native_score": int(SCORE_LEVELS[y[i]]),
                                                "probabilities": probabilities[i].tolist()})
                full, context, majority, median = (results[k] for k in ["full", "context_only", "majority", "median"])
                missing = [level for level in SCORE_LEVELS if level not in {r["labels"][dim] for r in subset}]
                family_report[dim] = {"status": "evaluated", "learner_groups": n_groups,
                                      "missing_score_levels": missing, "models": results,
                                      "beats_context_and_majority_rank_mae": full["rank_mae"] < min(
                                          context["rank_mae"], majority["rank_mae"], median["rank_mae"])}
                print(json.dumps({"family": family, "dimension": dim, "exams": full["exam_count"],
                                  "full_rank_mae": full["rank_mae"], "context_rank_mae": context["rank_mae"]}), flush=True)
            report["families"][family] = family_report
            write_json(out / "trial_report.json", report)
    write_jsonl(out / "oof_predictions.jsonl", predictions)
    joblib.dump({"models": bundle, "score_levels": SCORE_LEVELS, "report": report}, out / "models.joblib")
    write_json(out / "trial_report.json", report)
    return report


def predict_rows(model_path: Path, rows: list[dict], out: Path, threads: int = 2):
    # Only use trusted artifacts produced by this package: joblib/pickle is executable.
    bundle = joblib.load(model_path)
    predictions = []
    with threadpool_limits(limits=threads):
        for row in rows:
            if not row.get("features"):
                continue
            for dim in DIMENSIONS:
                model = bundle["models"].get(f"{row['family']}:{dim}")
                if model is None:
                    continue
                p = model.predict_proba([feature_dict(row, "full")])[0]
                predictions.append({"sample_id": row["sample_id"], "dimension": dim,
                                    "probabilities": p.tolist(),
                                    "predicted_native_score": SCORE_LEVELS[int(np.argmax(p))]})
    write_jsonl(out, predictions)
    return len(predictions)
