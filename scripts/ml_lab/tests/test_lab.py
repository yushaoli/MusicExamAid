from __future__ import annotations

import csv
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import wave

import numpy as np

from scripts.ml_lab.calibration import (FIELDS, calibrate_gate, make_packet,
                                        validate_labels, wilson)
from scripts.ml_lab.data import (ACOUSTIC_FEATURES, DIMENSIONS, SCORE_LEVELS, load_dataset,
                                 media_path, new_output, read_jsonl, reserved_groups,
                                 write_jsonl)
from scripts.ml_lab.ordinal import (OrdinalClassifier, aggregate_exams, exam_weights,
                                    predict_rows, run_trial)
from scripts.ml_lab.__main__ import extract_features


class LabTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.root = self.base / "dataset"
        self.root.mkdir()
        (self.root / "videos").mkdir()
        (self.root / "audio_24k").mkdir()
        self.manifest, self.cache = [], []
        for learner in range(24):
            for clip in [1, 2]:
                cid = f"{learner}_{clip}"
                labels = {d: SCORE_LEVELS[(learner + j) % 4] for j, d in enumerate(DIMENSIONS)}
                self.manifest.append({"season_code": "20254", "clip_id": cid,
                    "exam_id": learner, "learner_anon_id": f"anon-{learner}",
                    "instrument_cn": "钢琴", "grade_level": learner % 10 + 1,
                    "oss_live_expected": True, "score_5d": labels,
                    "source_url": f"https://example.invalid/{cid}", "video_md5": f"md5-{cid}",
                    "rel_video_path": f"videos/{cid}.mp4", "rel_audio_path": f"audio_24k/{cid}.wav"})
                features = {name: float((learner % 4) + 1) for name in ACOUSTIC_FEATURES}
                features["active_ratio"] = 0.5
                self.cache.append({"season_code": "20254", "clip_id": cid, "features": features,
                                   "score_5d": {d: 999 for d in DIMENSIONS}})
                (self.root / f"videos/{cid}.mp4").write_bytes(b"x" * 2048)
                (self.root / f"audio_24k/{cid}.wav").write_bytes(b"x" * 8192)
        self.save()

    def tearDown(self):
        self.temp.cleanup()

    def save(self):
        write_jsonl(self.root / "manifest_all_clips.jsonl", self.manifest)
        write_jsonl(self.root / "acoustic_features_cache.jsonl", self.cache)

    def test_audit_uses_manifest_labels_and_keeps_sources_unchanged(self):
        before = (self.root / "acoustic_features_cache.jsonl").read_bytes()
        rows, audit = load_dataset(self.root)
        self.assertEqual(audit["counts"]["valid_cached_feature_clips"], 48)
        self.assertEqual(rows[0]["labels"][DIMENSIONS[0]], 0)
        self.assertEqual((self.root / "acoustic_features_cache.jsonl").read_bytes(), before)
        self.assertNotIn("https://example", json.dumps(audit))
        self.assertNotIn("source_url", rows[0])

    def test_zero_vectors_and_unknown_scores_are_not_silently_trained(self):
        self.manifest[0]["score_5d"] = {d: 0 for d in DIMENSIONS}
        self.manifest[1]["score_5d"][DIMENSIONS[0]] = 8
        self.save()
        rows, audit = load_dataset(self.root)
        self.assertTrue(all(v is None for v in rows[0]["labels"].values()))
        self.assertTrue(all(v is None for v in rows[1]["labels"].values()))
        self.assertEqual(audit["counts"]["ambiguous_all_zero_labels"], 1)
        self.assertEqual(audit["counts"]["unsupported_score_values"], 1)

    def test_grouping_connects_learners_and_duplicate_media_across_seasons(self):
        self.manifest[2]["video_md5"] = self.manifest[0]["video_md5"]
        self.manifest[4]["source_url"] = self.manifest[2]["source_url"] + "?token=changed"
        self.save()
        rows, _ = load_dataset(self.root)
        self.assertEqual(len({r["group"] for r in rows[:6]}), 1)

    def test_duplicate_keys_and_conflicting_features_fail(self):
        self.manifest.append(self.manifest[0])
        self.save()
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            load_dataset(self.root)
        self.manifest.pop()
        self.save()
        extra = self.base / "extra.jsonl"
        write_jsonl(extra, [{**self.cache[0], "features": {"duration_sec": 123}}])
        with self.assertRaisesRegex(ValueError, "Conflicting"):
            load_dataset(self.root, extra)

    def test_media_and_output_paths_are_confined_but_das_symlinks_work(self):
        with self.assertRaises(ValueError):
            media_path(self.root, "videos/../../secret", "videos")
        with self.assertRaises(ValueError):
            new_output(self.root, self.root / "audio_24k/output")
        allowed = self.base / "other-das"
        allowed.mkdir()
        (self.root / "videos/approved").symlink_to(allowed, target_is_directory=True)
        with self.assertRaises(ValueError):
            media_path(self.root, "videos/approved/file", "videos")
        # The top-level videos symlink itself is the approved DAS4T boundary.
        empty = self.base / "symlink-dataset"
        empty.mkdir()
        (empty / "videos").symlink_to(allowed, target_is_directory=True)
        self.assertEqual(media_path(empty, "videos/file", "videos"), (allowed / "file").resolve())

    def test_packet_is_blind_and_reserves_all_clips_from_each_group(self):
        rows, _ = load_dataset(self.root)
        packet = new_output(self.root, self.base / "packet")
        summary = make_packet(rows, packet, size=8)
        self.assertEqual(summary["independent_groups"], 8)
        self.assertEqual(summary["by_subset"], {"calibration": 4, "heldout_test": 4})
        content = (packet / "teacher_labels.csv").read_text(encoding="utf-8-sig")
        self.assertNotIn("source_url", content)
        with (packet / "teacher_labels.csv").open(encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                self.assertTrue(all(not row[d] for d in DIMENSIONS))
                self.assertEqual(row["verdict"], "")
        excluded = reserved_groups(rows, packet)
        self.assertEqual(sum(r["group"] in excluded for r in rows), 16)
        labeled, result = validate_labels(packet, packet / "teacher_labels.csv")
        self.assertEqual(labeled, [])
        self.assertEqual(result["pending_clips"], 8)

    def test_label_import_rejects_missing_rows_and_invalid_scores(self):
        rows, _ = load_dataset(self.root)
        packet = new_output(self.root, self.base / "packet")
        make_packet(rows, packet, size=4)
        path = packet / "teacher_labels.csv"
        with path.open(encoding="utf-8-sig") as f:
            entries = list(csv.DictReader(f))
        entries[0].update(verdict="PASS", reviewer_alias="T1", reviewed_at="2026-10-23T10:00:00+08:00",
                          subset="tampered", **{DIMENSIONS[0]: "10"})
        self.write_labels(path, entries)
        labeled, _ = validate_labels(packet, path)
        self.assertEqual(labeled[0]["subset"], "calibration")
        entries[0][DIMENSIONS[0]] = "8"
        self.write_labels(path, entries)
        with self.assertRaisesRegex(ValueError, "0/3/6/10"):
            validate_labels(packet, path)
        self.write_labels(path, entries[1:])
        with self.assertRaisesRegex(ValueError, "retain all"):
            validate_labels(packet, path)

    @staticmethod
    def write_labels(path, entries):
        with path.open("w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=FIELDS)
            writer.writeheader()
            writer.writerows(entries)

    def test_ordinal_distribution_is_valid_when_thresholds_cross_or_classes_are_missing(self):
        model = OrdinalClassifier(iterations=2)
        model.vectorizer.fit([{"x": 1}])
        model.thresholds = [0.2, 0.8, 0.1]
        p = model.predict_proba([{"x": 1}, {"x": 2}])
        self.assertTrue(np.all(p >= 0))
        np.testing.assert_allclose(p.sum(axis=1), 1)
        model.fit([{"x": i} for i in range(4)], np.array([2, 2, 2, 2]), np.ones(4))
        np.testing.assert_allclose(model.predict_proba([{"x": 1}]), [[0, 0, 1, 0]])

    def test_exam_weighting_and_evaluation_do_not_count_each_clip_as_a_new_label(self):
        rows = [{"exam_key": "a"}, {"exam_key": "a"}, {"exam_key": "b"}]
        weights = exam_weights(rows)
        self.assertAlmostEqual(weights[:2].sum(), weights[2])
        y, p, keys = aggregate_exams(rows, np.array([1, 1, 3]), np.eye(4)[[1, 1, 3]])
        self.assertEqual(len(y), 2)
        with self.assertRaisesRegex(ValueError, "Conflicting"):
            aggregate_exams(rows, np.array([1, 2, 3]), np.eye(4)[[1, 2, 3]])

    def test_trial_excludes_reserved_learners_and_serialized_inference_works(self):
        rows, _ = load_dataset(self.root)
        packet = new_output(self.root, self.base / "packet")
        make_packet(rows, packet, size=4)
        excluded = reserved_groups(rows, packet)
        out = new_output(self.root, self.base / "trial")
        result = run_trial(rows, excluded, out, folds=2, min_groups=2, max_groups=0,
                           iterations=2, threads=1)
        self.assertFalse(result["production_ready"])
        snapshot = read_jsonl(out / "training_snapshot.jsonl")
        self.assertFalse({r["group"] for r in snapshot} & excluded)
        fold_by_group = {}
        for r in read_jsonl(out / "oof_predictions.jsonl"):
            key = (r["dimension"], r["group"])
            self.assertEqual(fold_by_group.setdefault(key, r["fold"]), r["fold"])
        predicted = self.base / "predicted.jsonl"
        self.assertEqual(predict_rows(out / "models.joblib", rows[:1], predicted, threads=1), 5)

    def test_calibration_waits_for_real_labels_and_does_not_tune_on_test_labels(self):
        out = new_output(self.root, self.base / "calibration")
        report = calibrate_gate([], [], out)
        self.assertEqual(report["status"], "awaiting_teacher_labels_and_feature_coverage")
        rows, labels = [], []
        for subset in ["calibration", "heldout_test"]:
            for i in range(10):
                sid = f"{subset}-{i}"
                rows.append({"sample_id": sid, "features": {"active_ratio": 0.05 if i < 5 else 0.8}})
                labels.append({"sample_id": sid, "subset": subset, "verdict": "REJECT" if i < 5 else "PASS"})
        first = calibrate_gate(rows, labels, out)
        for r in labels:
            if r["subset"] == "heldout_test":
                r["verdict"] = "PASS" if r["verdict"] == "REJECT" else "REJECT"
        second = calibrate_gate(rows, labels, out)
        self.assertEqual(first["selected_threshold"], second["selected_threshold"])
        self.assertGreater(wilson(0, 100)[1], 0.01)

    def test_bounded_wav_extraction_writes_only_a_new_cache(self):
        self.cache = self.cache[1:]
        self.save()
        wav = self.root / self.manifest[0]["rel_audio_path"]
        signal = (12000 * np.sin(2 * np.pi * 440 * np.arange(24000 * 4) / 24000)).astype("<i2")
        with wave.open(str(wav), "wb") as f:
            f.setnchannels(1)
            f.setsampwidth(2)
            f.setframerate(24000)
            f.writeframes(signal.tobytes())
        before = (self.root / "acoustic_features_cache.jsonl").read_bytes()
        rows, _ = load_dataset(self.root)
        out = new_output(self.root, self.base / "features")
        skipped = new_output(self.root, self.base / "unselected-features")
        self.assertEqual(extract_features(self.root, rows, skipped, limit=1, seed=42,
                                         sample_ids={"not-selected"})["new_feature_clips"], 0)
        report = extract_features(self.root, rows, out, limit=1, seed=42)
        self.assertEqual(report["new_feature_clips"], 1)
        self.assertEqual((self.root / "acoustic_features_cache.jsonl").read_bytes(), before)
        updated, _ = load_dataset(self.root, out / "features.jsonl")
        self.assertIsNotNone(updated[0]["features"])

    def test_cli_requires_teacher_reservation_before_creating_a_trial(self):
        out = self.base / "not-created"
        result = subprocess.run([sys.executable, "-m", "scripts.ml_lab", "trial", "--dataset-root",
                                 str(self.root), "--out", str(out)], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--packet", result.stderr)
        self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main()
