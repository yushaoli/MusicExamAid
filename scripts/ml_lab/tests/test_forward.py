from __future__ import annotations

import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import joblib
import numpy as np

from scripts.ml_lab.data import ACOUSTIC_FEATURES, DIMENSIONS, SCORE_LEVELS, read_jsonl
from scripts.ml_lab.forward import run_forward_trial, split_seasons


class ForwardTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name)
        self.rows = []
        for season, count in [("20254", 32), ("20265", 12), ("20275", 4)]:
            for i in range(count):
                group = f"old-{i}" if season == "20254" else f"{season}-{i}"
                for clip in [0, 1]:
                    self.rows.append({"sample_id": f"{season}-{i}-{clip}", "clip_key": f"{season}:{i}-{clip}",
                        "exam_key": f"{season}:{i}", "season": season, "group": group,
                        "family": "keyboard", "instrument": "钢琴", "grade": i % 10 + 1,
                        "audio_available": True, "features": {k: float(i + 1) for k in ACOUSTIC_FEATURES},
                        "labels": {dim: SCORE_LEVELS[(i + j) % 4] for j, dim in enumerate(DIMENSIONS)}})
        for row in self.rows:
            if row["exam_key"] == "20265:0":
                row["group"] = "old-0"  # duplicate/returning learner across seasons
        unavailable = copy.deepcopy(self.rows[0])
        unavailable.update(season="20265", sample_id="unavailable", clip_key="20265:unavailable",
                           exam_key="20265:unavailable", group="old-1", audio_available=False,
                           features=None, labels={d: None for d in DIMENSIONS})
        self.rows.append(unavailable)
        self.excluded = {"old-2", "20265-2"}

    def tearDown(self):
        self.temporary.cleanup()

    def test_season_split_purges_unavailable_unlabeled_groups_and_excludes_future_and_teacher_groups(self):
        train, test, counts = split_seasons(self.rows, self.excluded, "20265")
        self.assertEqual({r["season"] for r in train}, {"20254"})
        self.assertEqual({r["season"] for r in test}, {"20265"})
        self.assertFalse({r["group"] for r in train} & {"old-0", "old-1", *self.excluded})
        self.assertFalse({r["group"] for r in test} & self.excluded)
        self.assertFalse({r["group"] for r in train} & {r["group"] for r in test})
        self.assertEqual(counts["purged_historical_clips"], 4)
        with self.assertRaises(ValueError):
            split_seasons(self.rows, self.excluded, "20995")

    def test_forward_models_ignore_test_labels_and_save_all_variant_predictions_per_exam(self):
        first = self.base / "first"
        first.mkdir()
        result = run_forward_trial(self.rows, self.excluded, first, test_season="20265",
                                   min_groups=2, min_test_groups=2, iterations=2, threads=1)
        self.assertFalse(result["production_ready"])
        predictions = read_jsonl(first / "test_predictions.jsonl")
        self.assertEqual(len(predictions), 11 * 2 * 5)
        self.assertTrue(all(set(r["model_probabilities"]) == {"majority", "median", "context_only", "acoustic_only", "full"} for r in predictions))
        for dims in result["families"].values():
            for case in dims.values():
                self.assertTrue(all(m["exam_count"] == 11 for m in case["models"].values()))
        train = read_jsonl(first / "train_snapshot.jsonl")
        # Baseline class frequencies count each training exam once, even with two clips.
        unique = {r["exam_key"]: r for r in train}
        expected = np.bincount([SCORE_LEVELS.index(r["labels"][DIMENSIONS[0]]) for r in unique.values()], minlength=4)
        p = next(r for r in predictions if r["dimension"] == DIMENSIONS[0])["model_probabilities"]["majority"]
        np.testing.assert_allclose(p, expected / expected.sum())
        changed = copy.deepcopy(self.rows)
        for row in changed:
            if row["season"] == "20265":
                row["labels"] = {d: 3 for d in DIMENSIONS}
        second = self.base / "second"
        second.mkdir()
        run_forward_trial(changed, self.excluded, second, test_season="20265",
                          min_groups=2, min_test_groups=2, iterations=2, threads=1)
        a, b = (joblib.load(path / "models.joblib")["models"] for path in [first, second])
        features = [{**self.rows[0]["features"], "instrument": "钢琴", "grade": 0.5}]
        self.assertEqual(set(a), set(b))
        for key in a:
            np.testing.assert_allclose(a[key].predict_proba(features), b[key].predict_proba(features))

    def test_insufficient_test_groups_produce_no_default_predictions(self):
        out = self.base / "small"
        out.mkdir()
        report = run_forward_trial(self.rows, self.excluded, out, test_season="20265",
                                   min_groups=2, min_test_groups=50, iterations=2, threads=1)
        self.assertTrue(all(c["status"] == "insufficient_data" for dims in report["families"].values() for c in dims.values()))
        self.assertEqual(read_jsonl(out / "test_predictions.jsonl"), [])
        self.assertEqual(joblib.load(out / "models.joblib")["models"], {})

    def test_cli_requires_explicit_season_and_teacher_reservation_before_creating_output(self):
        for args in [["--test-season", "20265"], ["--packet", str(self.base / "packet")]]:
            out = self.base / "not-created"
            result = subprocess.run([sys.executable, "-m", "scripts.ml_lab", "forward-trial",
                                     "--dataset-root", str(self.base), "--out", str(out), *args],
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main()
