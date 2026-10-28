from __future__ import annotations

import base64
import csv
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from scripts.ml_lab.calibration import FIELDS, validate_labels
from scripts.ml_lab.data import write_json, write_jsonl
from scripts.ml_lab.review import ReviewServer, ReviewStore


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        (self.root / "videos").mkdir()
        self.packet = self.root / "experiments/packet"
        self.packet.mkdir(parents=True)
        self.items = [{"sample_id": char * 20, "group": "hidden-group-" + char,
                       "instrument": "钢琴 <test>", "grade": 3, "subset": subset,
                       "rel_video_path": f"videos/{char}.mp4", "rel_audio_path": f"audio_24k/{char}.wav"}
                      for char, subset in [("a", "calibration"), ("b", "heldout_test")]]
        for item in self.items:
            (self.root / item["rel_video_path"]).write_bytes(bytes(range(256)) * 8)
        write_jsonl(self.packet / "items.jsonl", self.items)
        write_json(self.packet / "reservation.json", {"groups": [r["group"] for r in self.items]})
        with (self.packet / "teacher_labels.csv").open("w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=FIELDS)
            writer.writeheader()
            writer.writerows({k: r.get(k, "") for k in FIELDS} for r in self.items)
        self.original = (self.packet / "teacher_labels.csv").read_bytes()
        self.state = self.root / "experiments/review-state"
        self.store = ReviewStore(self.root, self.packet, self.state)
        self.server = ReviewServer(self.store, 0)
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.origin = f"http://127.0.0.1:{self.server.server_port}"
        access = self.store.access
        self.auth = "Basic " + base64.b64encode(f"{access['username']}:{access['password']}".encode()).decode()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.worker.join()
        self.store.close()
        self.temporary.cleanup()

    def request(self, path, data=None, headers=None, method=None, auth=True):
        h = {"Authorization": self.auth} if auth else {}
        if data is not None:
            h.update({"Origin": self.origin, "Content-Type": "application/json"})
        h.update(headers or {})
        req = Request(self.origin + path, data=json.dumps(data).encode() if data is not None else None,
                      headers=h, method=method)
        try:
            with urlopen(req) as response:
                return response.status, response.read(), dict(response.headers)
        except HTTPError as e:
            return e.code, e.read(), dict(e.headers)

    def payload(self, verdict="PASS", notes=""):
        return {"sample_id": self.items[0]["sample_id"], "revision": self.store.public()["revision"],
                "verdict": verdict, "notes": notes, "reviewer_alias": "T1"}

    def test_auth_origin_and_host_checks_protect_page_labels_and_media(self):
        for path in ["/", "/api/packet", "/labels.csv", "/media/" + self.items[0]["sample_id"]]:
            self.assertEqual(self.request(path, auth=False)[0], 401)
        self.assertEqual(self.request("/api/packet", headers={"Host": "outside.invalid"})[0], 403)
        self.assertEqual(self.request("/api/labels", self.payload(), {"Origin": "https://outside.invalid"})[0], 403)
        self.assertEqual(self.store.public()["reviewed"], 0)

    def test_public_data_is_blinded_and_escaping_is_left_to_text_content(self):
        status, content, headers = self.request("/api/packet")
        self.assertEqual(status, 200)
        public = json.loads(content)
        self.assertEqual(public["reviewed"], 0)
        for item in public["items"]:
            self.assertEqual(set(item), {"sample_id", "instrument", "grade", "verdict", "notes", "reviewer_alias", "reviewed_at"})
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
        self.assertEqual(self.request("/../../access.json")[0], 404)
        self.assertEqual(self.request("/media/unknown")[0], 404)

    def test_video_ranges_and_head_support_seeking_without_reading_other_paths(self):
        path = "/media/" + self.items[0]["sample_id"]
        status, content, headers = self.request(path, headers={"Range": "bytes=10-29"})
        self.assertEqual(status, 206)
        self.assertEqual(content, bytes(range(10, 30)))
        self.assertEqual(headers["Content-Range"], "bytes 10-29/2048")
        self.assertEqual(self.request(path, headers={"Range": "bytes=-4"})[1], bytes(range(252, 256)))
        self.assertEqual(self.request(path, method="HEAD")[1], b"")
        for invalid in ["bytes=2048-", "bytes=9-2", "bytes=-0", "bytes=0-1,4-5"]:
            self.assertEqual(self.request(path, headers={"Range": invalid})[0], 416)
        (self.root / self.items[0]["rel_video_path"]).unlink()
        self.assertEqual(self.request(path)[0], 404)

    def test_explicit_save_preserves_blanks_multiline_notes_and_original_packet(self):
        self.assertEqual(self.request("/api/labels", self.payload("REJECT"))[0], 400)
        payload = self.payload("NEEDS_HUMAN_CHECK", "第一行\n第二行 <script> 不执行")
        status, content, _ = self.request("/api/labels", payload)
        self.assertEqual(status, 200)
        saved = json.loads(content)
        self.assertEqual(saved["reviewed"], 1)
        self.assertEqual(saved["items"][0]["notes"], payload["notes"])
        self.assertEqual(saved["items"][1]["verdict"], "")
        self.assertEqual(self.request("/api/labels", payload)[0], 409)
        labels, summary = validate_labels(self.packet, self.store.csv)
        self.assertEqual(summary["pending_clips"], 1)
        self.assertTrue(all(v is None for v in labels[0]["labels"].values()))
        exported = list(csv.DictReader(io.StringIO(self.request("/labels.csv")[1].decode("utf-8-sig"))))
        self.assertEqual(exported[0]["subset"], "calibration")
        self.assertEqual((self.packet / "teacher_labels.csv").read_bytes(), self.original)
        self.store.close()
        self.store = ReviewStore(self.root, self.packet, self.state)
        self.server.store = self.store
        self.assertEqual(self.store.public()["items"][0]["notes"], payload["notes"])
        self.assertEqual(self.store.public()["reviewed"], 1)

    def test_state_lock_and_packet_identity_prevent_concurrent_or_wrong_packet_writes(self):
        with self.assertRaisesRegex(ValueError, "Another reviewer"):
            ReviewStore(self.root, self.packet, self.state)
        with self.assertRaisesRegex(ValueError, "separate"):
            ReviewStore(self.root, self.packet, self.packet)
        with self.assertRaisesRegex(ValueError, "under dataset-root"):
            ReviewStore(self.root, self.packet, self.root / "outside")
        self.store.close()
        original = (self.packet / "reservation.json").read_bytes()
        write_json(self.packet / "reservation.json", {"groups": ["changed"]})
        with self.assertRaisesRegex(ValueError, "different"):
            ReviewStore(self.root, self.packet, self.state)
        (self.packet / "reservation.json").write_bytes(original)
        self.store = ReviewStore(self.root, self.packet, self.state)
        self.server.store = self.store


if __name__ == "__main__":
    unittest.main()
