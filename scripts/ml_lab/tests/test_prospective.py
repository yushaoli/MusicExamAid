from __future__ import annotations

import copy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import unittest

import joblib
import numpy as np

from scripts.ml_lab.data import (DIMENSIONS, SCORE_LEVELS, feature_dict, load_dataset,
                                 new_output, read_jsonl, write_json, write_jsonl)
from scripts.ml_lab.ordinal import OrdinalClassifier
from scripts.ml_lab.prospective import (calibrate_official, enroll, evaluate_official,
    freeze_candidate, probability_metrics, temperature_scale)
from scripts.ml_lab.tests import test_lab


class ProspectiveTests(unittest.TestCase):
    def setUp(self):
        self.previous_umask = os.umask(0o077)
        self.fixture = test_lab.LabTests(methodName="runTest")
        self.fixture.setUp()
        self.base, self.root = self.fixture.base, self.fixture.root
        self.packet = self.base / "packet"
        self.packet.mkdir()
        write_json(self.packet / "reservation.json", {"learners": [], "video_md5s": []})
        self.model_dir = self.base / "candidate"
        self.model_dir.mkdir()
        rows, _ = load_dataset(self.root)
        write_jsonl(self.model_dir / "training_snapshot.jsonl", rows)
        # Deliberately overconfident synthetic classifier; no real recordings/labels.
        model = OrdinalClassifier(iterations=2)
        model.vectorizer.fit([feature_dict(r, "full") for r in rows])
        model.thresholds = [0.97, 0.95, 0.02]
        joblib.dump({"score_levels": SCORE_LEVELS, "models": {f"keyboard:{DIMENSIONS[0]}": model},
                     "report": {"kind": "offline_ordinal_trial"}}, self.model_dir / "models.joblib")
        self.start = datetime(2026, 10, 1, tzinfo=timezone.utc)
        self.closed = datetime(2026, 10, 3, tzinfo=timezone.utc)

    def tearDown(self):
        self.fixture.tearDown()
        os.umask(self.previous_umask)

    def output(self, name):
        return new_output(self.root, self.base / name)

    def save(self):
        self.fixture.save()
        # Synthetic intake snapshot captured before the fixed closing time.
        os.utime(self.root / "manifest_all_clips.jsonl", (self.start.timestamp(), self.start.timestamp()))

    def freeze(self, name="frozen", **options):
        path = self.output(name)
        freeze_candidate(self.root, self.model_dir, self.packet, path, season="20265",
                         close_at="2026-10-02T00:00:00+00:00", min_groups=10,
                         min_class_exams=2, min_test_groups=5, threads=1, now=self.start, **options)
        return path

    def add_incoming(self, count=80):
        for i in range(count):
            for clip in range(2):
                row = copy.deepcopy(self.fixture.manifest[0])
                cid = f"new-{i}-{clip}"
                row.update(season_code="20265", clip_id=cid, exam_id=1000+i,
                    learner_anon_id=f"new-{i}", source_url=f"https://new.example.invalid/{cid}",
                    video_md5=f"new-md5-{cid}", rel_video_path=f"videos/{cid}.mp4",
                    rel_audio_path=f"audio_24k/{cid}.wav",
                    score_5d={d: SCORE_LEVELS[i % 4] if d == DIMENSIONS[0] else 6 for d in DIMENSIONS})
                self.fixture.manifest.append(row)
                self.fixture.cache.append({"season_code": "20265", "clip_id": cid,
                    "features": self.fixture.cache[0]["features"]})
                (self.root / row["rel_video_path"]).write_bytes(b"v" * 2048)
                (self.root / row["rel_audio_path"]).write_bytes(b"a" * 8192)
        self.save()

    def ready(self):
        frozen = self.freeze()
        self.add_incoming()
        enrolled = self.output("enrolled")
        enroll(self.root, frozen, enrolled, now=self.closed)
        return frozen, enrolled

    def test_score_blind_reader_ignores_malformed_scores_and_cache_labels(self):
        for row in self.fixture.manifest:
            row["score_5d"] = "must not be interpreted"
        self.save()
        rows, audit = load_dataset(self.root, include_labels=False)
        self.assertFalse(audit["labels_loaded"])
        self.assertTrue(all(all(v is None for v in r["labels"].values()) for r in rows))
        self.assertTrue(all(not counts for counts in audit["cached_class_counts"].values()))

    def test_enrollment_excludes_old_and_reserved_identities_and_keeps_unavailable_groups(self):
        # Reservation identities must survive even if their recordings are not in history.
        write_json(self.packet / "reservation.json", {"learners": ["new-4"], "video_md5s": []})
        frozen = self.freeze()
        self.add_incoming()
        incoming = self.fixture.manifest[48:]
        # Old learner, duplicate MD5 and same URL with a different query string.
        for row in incoming[:2]:
            row["learner_anon_id"] = "anon-0"
        for row in incoming[2:4]:
            row["video_md5"] = self.fixture.manifest[0]["video_md5"]
        for row in incoming[4:6]:
            row["source_url"] = self.fixture.manifest[0]["source_url"] + "?rotated=1"
        # New unavailable media still reserves its group, without a fake prediction.
        for row in incoming[6:8]:
            (self.root / row["rel_audio_path"]).unlink()
            row["score_5d"] = None
        self.save()
        out = self.output("enrolled")
        enroll(self.root, frozen, out, now=self.closed)
        cohort = read_jsonl(out / "cohort.jsonl")
        exams = {r["exam_key"] for r in cohort}
        self.assertEqual(len(exams), 76)
        self.assertTrue({"20265:1000", "20265:1001", "20265:1002", "20265:1004"}.isdisjoint(exams))
        self.assertIn("20265:1003", exams)
        predictions = [r for subset in ("calibration", "heldout_test")
                       for r in read_jsonl(out / f"{subset}_predictions.jsonl")]
        self.assertEqual(len(predictions), 75)  # each exam once, despite two clips
        self.assertTrue(all(set(r["model_probabilities"]) == {"majority", "median", "context_only", "acoustic_only", "full"} for r in predictions))
        self.assertTrue(all("labels" not in r and "actual_native_score" not in r for r in predictions))
        subsets = {}
        for row in cohort:
            self.assertEqual(subsets.setdefault(row["group"], row["subset"]), row["subset"])
        self.assertTrue(all(p.stat().st_mode & 0o077 == 0 for p in out.glob("*.json*")))

    def test_clock_and_single_enrollment_guards(self):
        frozen = self.freeze()
        self.add_incoming()
        with self.assertRaisesRegex(ValueError, "still open"):
            enroll(self.root, frozen, self.output("early"), now=self.start)
        os.utime(self.root / "manifest_all_clips.jsonl", (self.closed.timestamp(), self.closed.timestamp()))
        with self.assertRaisesRegex(ValueError, "snapshot captured"):
            enroll(self.root, frozen, self.output("late-snapshot"), now=self.closed)
        self.save()
        enroll(self.root, frozen, self.output("enrolled"), now=self.closed)
        with self.assertRaisesRegex(ValueError, "already has"):
            enroll(self.root, frozen, self.output("another"), now=self.closed)

    def test_scores_cannot_change_enrollment_or_frozen_predictions(self):
        frozen = self.freeze()
        duplicate = self.base / "duplicate-freeze"
        shutil.copytree(frozen, duplicate)
        self.add_incoming()
        first = self.output("first-enrollment")
        enroll(self.root, frozen, first, now=self.closed)
        for row in self.fixture.manifest[48:]:
            row["score_5d"] = "not a score object"
        self.save()
        second = self.output("second-enrollment")
        enroll(self.root, duplicate, second, now=self.closed)
        for name in ("cohort.jsonl", "calibration_predictions.jsonl", "heldout_test_predictions.jsonl"):
            self.assertEqual((first / name).read_bytes(), (second / name).read_bytes())

    def test_fixed_intake_snapshot_does_not_admit_later_arrivals(self):
        frozen = self.freeze()
        self.add_incoming()
        snapshot = self.base / "intake.jsonl"
        shutil.copyfile(self.root / "manifest_all_clips.jsonl", snapshot)
        os.utime(snapshot, (self.start.timestamp(), self.start.timestamp()))
        late = copy.deepcopy(self.fixture.manifest[-1])
        late.update(clip_id="late", exam_id=9999, learner_anon_id="late-learner",
                    source_url="https://new.example.invalid/late", video_md5="late-md5")
        self.fixture.manifest.append(late)
        self.save()
        os.utime(self.root / "manifest_all_clips.jsonl", (self.closed.timestamp(), self.closed.timestamp()))
        out = self.output("snapshot-enrollment")
        enroll(self.root, frozen, out, manifest_path=snapshot, now=self.closed)
        cohort = read_jsonl(out / "cohort.jsonl")
        self.assertEqual(len({r["exam_key"] for r in cohort}), 80)
        self.assertNotIn("20265:9999", {r["exam_key"] for r in cohort})

    def test_rehearsal_mode_is_retained_through_calibration_and_final_report(self):
        frozen = self.freeze(rehearsal=True)
        self.add_incoming()
        enrolled = self.output("enrolled")
        enroll(self.root, frozen, enrolled, now=self.closed)
        calibration = self.output("rehearsal-calibration")
        calibrate_official(self.root, frozen, enrolled, calibration)
        final = self.output("rehearsal-final")
        evaluate_official(self.root, frozen, enrolled, calibration, final)
        for path in (frozen / "protocol.json", enrolled / "enrollment.json",
                     calibration / "calibrator.json", final / "test_report.json"):
            self.assertEqual(json.loads(path.read_text())["mode"], "retrospective_rehearsal")

    def test_calibration_cannot_create_support_for_a_missing_base_class(self):
        bundle = joblib.load(self.model_dir / "models.joblib")
        bundle["models"][f"keyboard:{DIMENSIONS[0]}"].thresholds = [0.97, 0.97, 0.02]
        joblib.dump(bundle, self.model_dir / "models.joblib")
        frozen, enrolled = self.ready()
        out = self.output("unsupported-class")
        result = calibrate_official(self.root, frozen, enrolled, out)
        self.assertEqual(result["fitted_cases"], 0)
        cases = json.loads((out / "calibrator.json").read_text())["cases"]
        self.assertEqual(cases[f"keyboard:{DIMENSIONS[0]}"]["status"], "observed_class_has_zero_base_probability")
        self.assertNotIn("temperature", cases[f"keyboard:{DIMENSIONS[0]}"])

    def test_teacher_reservation_and_conflicting_exam_metadata_fail_before_enrollment(self):
        write_json(self.packet / "reservation.json", {"learners": ["anon-0"], "video_md5s": []})
        with self.assertRaisesRegex(ValueError, "teacher reservation"):
            self.freeze("reserved-training")
        write_json(self.packet / "reservation.json", {"learners": [], "video_md5s": []})
        frozen = self.freeze()
        self.add_incoming()
        self.fixture.manifest[-1]["grade_level"] = 99
        self.save()
        with self.assertRaisesRegex(ValueError, "metadata within an exam"):
            enroll(self.root, frozen, self.output("conflicting-exam"), now=self.closed)
        self.assertFalse((frozen / "enrolled.json").exists())

    def test_temperature_keeps_argmax_and_exact_zero_support_and_bins_count_all_exams(self):
        p = np.array([[0, 0.01, 0.98, 0.01], [0, 0.6, 0.4, 0], [0, 0, 0, 1]])
        for t in [0.05, 1, 20]:
            q = temperature_scale(p, t)
            np.testing.assert_allclose(q.sum(axis=1), 1)
            np.testing.assert_array_equal(np.argmax(p, axis=1), np.argmax(q, axis=1))
            self.assertTrue((q[p == 0] == 0).all())
        result = probability_metrics(np.array([2, 1, 3]), p)
        self.assertEqual(sum(b["count"] for b in result["confidence_bins"]), 3)
        with self.assertRaises(ValueError):
            temperature_scale(np.array([[0, 0, 0, 0]]), 1)
        with self.assertRaises(ValueError):
            temperature_scale(p, float("nan"))

    def test_calibrator_ignores_test_scores_and_test_evaluation_is_once_only(self):
        frozen, enrolled = self.ready()
        first = self.output("calibration")
        calibrate_official(self.root, frozen, enrolled, first)
        original = json.loads((first / "calibrator.json").read_text())
        self.assertEqual(original["status"], "fitted")
        case = original["cases"][f"keyboard:{DIMENSIONS[0]}"]
        self.assertGreater(case["temperature"], 1)
        self.assertLess(case["calibrated"]["negative_log_loss"], case["uncalibrated"]["negative_log_loss"])
        self.assertEqual(case["calibrated"]["accuracy"], case["uncalibrated"]["accuracy"])
        test_exams = {r["exam_key"] for r in read_jsonl(enrolled / "heldout_test_predictions.jsonl")}
        for row in self.fixture.manifest:
            if f"{row['season_code']}:{row['exam_id']}" in test_exams:
                row["score_5d"] = "test scores must not be parsed during calibration"
        self.save()
        second = self.output("changed-test-calibration")
        calibrate_official(self.root, frozen, enrolled, second)
        changed = json.loads((second / "calibrator.json").read_text())
        self.assertEqual(original["cases"], changed["cases"])
        self.assertEqual(original["label_snapshot_sha256"], changed["label_snapshot_sha256"])
        self.assertTrue(test_exams.isdisjoint(json.loads((second / "calibration_labels.json").read_text())))
        for row in self.fixture.manifest:
            if f"{row['season_code']}:{row['exam_id']}" in test_exams:
                row["score_5d"] = {d: 10 for d in DIMENSIONS}
        self.save()
        final = self.output("final")
        evaluate_official(self.root, frozen, enrolled, second, final)
        report = json.loads((final / "test_report.json").read_text())
        self.assertFalse(report["production_ready"])
        result = report["cases"][f"keyboard:{DIMENSIONS[0]}"]
        self.assertEqual(result["exams"], len(test_exams))
        self.assertEqual(result["models"]["full"]["confusion_matrix"], result["models"]["calibrated_full"]["confusion_matrix"])
        self.assertEqual(len(read_jsonl(final / "test_predictions.jsonl")), len(test_exams))
        with self.assertRaisesRegex(ValueError, "already evaluated"):
            evaluate_official(self.root, frozen, enrolled, second, self.output("again"))
        with self.assertRaisesRegex(ValueError, "already evaluated"):
            calibrate_official(self.root, frozen, enrolled, self.output("retune"))

    def test_missing_official_scores_wait_without_default_calibration(self):
        frozen, enrolled = self.ready()
        for row in self.fixture.manifest[48:]:
            row["score_5d"] = None
        self.save()
        out = self.output("empty-calibration")
        result = calibrate_official(self.root, frozen, enrolled, out)
        self.assertEqual(result["status"], "awaiting_usable_calibration_labels")
        self.assertEqual(json.loads((out / "calibrator.json").read_text())["cases"], {})
        self.assertFalse((enrolled / "evaluated.json").exists())

    def test_new_duplicate_links_after_enrollment_cannot_cross_partitions(self):
        frozen, enrolled = self.ready()
        cohort = read_jsonl(enrolled / "cohort.jsonl")
        a = next(r for r in cohort if r["subset"] == "calibration")
        b = next(r for r in cohort if r["subset"] == "heldout_test")
        raw = {f"{r['season_code']}:{r['clip_id']}": r for r in self.fixture.manifest}
        raw[a["clip_key"]]["video_md5"] = raw[b["clip_key"]]["video_md5"]
        self.save()
        with self.assertRaisesRegex(ValueError, "cross historical or calibration/test"):
            calibrate_official(self.root, frozen, enrolled, self.output("merged"))

    def test_frozen_candidate_and_enrollment_reject_changed_artifacts(self):
        frozen, enrolled = self.ready()
        (enrolled / "calibration_predictions.jsonl").write_text("[]\n")
        with self.assertRaisesRegex(ValueError, "cohort/predictions changed"):
            calibrate_official(self.root, frozen, enrolled, self.output("changed"))
        (frozen / "candidate.joblib").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "candidate/history changed"):
            enroll(self.root, frozen, self.output("changed-model"), now=self.closed)

    def test_cli_rejects_missing_freeze_protocol_before_creating_output(self):
        out = self.base / "not-created"
        result = subprocess.run([sys.executable, "-m", "scripts.ml_lab.prospective", "freeze",
                                 "--dataset-root", str(self.root), "--out", str(out)], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--model-dir", result.stderr)
        self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main()
