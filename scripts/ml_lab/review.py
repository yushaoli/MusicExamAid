"""Private, loopback-only teacher review of an existing reserved packet.

Run with python -m scripts.ml_lab.review --help. No portal/database access.
"""
from __future__ import annotations

import argparse
import base64
import csv
import fcntl
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import re
import secrets
import tempfile
import threading
from urllib.parse import urlsplit

from .calibration import FIELDS, VERDICTS, validate_labels
from .data import media_path, read_jsonl, stamp, write_json

STATIC = Path(__file__).with_name("review_ui")


class ReviewStore:
    def __init__(self, root: Path, packet: Path, state: Path):
        self.root, self.packet, self.state = root.resolve(), packet.resolve(), state.resolve()
        experiments = (self.root / "experiments").resolve()
        if not self.state.is_relative_to(experiments) or self.state == experiments:
            raise ValueError("Review state must be a private directory under dataset-root/experiments")
        if self.state.is_relative_to(self.packet) or self.packet.is_relative_to(self.state):
            raise ValueError("Review state must be separate from the original packet")
        self.state.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.state, 0o700)
        self.lock_file = (self.state / ".review.lock").open("a")
        try:
            fcntl.flock(self.lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self.lock_file.close()
            raise ValueError("Another reviewer server holds this state directory") from None
        try:
            self.items = read_jsonl(self.packet / "items.jsonl")
            self.by_id = {r["sample_id"]: r for r in self.items}
            if not self.items or len(self.by_id) != len(self.items):
                raise ValueError("Packet must contain unique review items")
            for item in self.items:
                media_path(self.root, item["rel_video_path"], "videos")
            fingerprint = hashlib.sha256((self.packet / "items.jsonl").read_bytes() +
                                         (self.packet / "reservation.json").read_bytes()).hexdigest()
            marker = self.state / "packet.json"
            if marker.exists():
                if json.loads(marker.read_text())["sha256"] != fingerprint:
                    raise ValueError("Review state belongs to a different reserved packet")
            else:
                if any((self.state / n).exists() for n in ["teacher_labels.csv", "access.json"]):
                    raise ValueError("Review state is incomplete; use a new directory")
                validate_labels(self.packet, self.packet / "teacher_labels.csv")
                self._atomic_csv((self.packet / "teacher_labels.csv").read_bytes())
                write_json(marker, {"sha256": fingerprint, "created_at": stamp()})
            self.csv = self.state / "teacher_labels.csv"
            validate_labels(self.packet, self.csv)
            access = self.state / "access.json"
            if not access.exists():
                write_json(access, {"username": "teacher", "password": secrets.token_urlsafe(32)})
            os.chmod(access, 0o600)
            self.access = json.loads(access.read_text())
            self.mutex = threading.RLock()
        except Exception:
            self.close()
            raise

    def close(self):
        self.lock_file.close()

    def _atomic_csv(self, content: bytes):
        with tempfile.NamedTemporaryFile(dir=self.state, prefix="labels-", suffix=".csv", delete=False) as f:
            path = Path(f.name)
            try:
                f.write(content)
                f.flush()
                os.fsync(f.fileno())
                validate_labels(self.packet, path)
                path.replace(self.state / "teacher_labels.csv")
            finally:
                path.unlink(missing_ok=True)

    def _read(self):
        content = self.csv.read_bytes()
        entries = list(csv.DictReader(io.StringIO(content.decode("utf-8-sig"), newline="")))
        return entries, hashlib.sha256(content).hexdigest()

    def public(self):
        with self.mutex:
            entries, revision = self._read()
            by_id = {r["sample_id"]: r for r in entries}
            return {"revision": revision, "total": len(self.items),
                    "reviewed": sum(bool(r["verdict"].strip()) for r in entries),
                    "items": [{"sample_id": item["sample_id"], "instrument": item["instrument"],
                               "grade": item["grade"], **{k: by_id[item["sample_id"]][k]
                               for k in ["verdict", "notes", "reviewer_alias", "reviewed_at"]}}
                              for item in self.items]}

    def save(self, data: dict):
        with self.mutex:
            entries, revision = self._read()
            if data.get("revision") != revision:
                raise FileExistsError("记录已在其他页面更新。请重新载入后核对，当前输入尚未保存。")
            sid, verdict = data.get("sample_id"), data.get("verdict")
            alias, notes = data.get("reviewer_alias"), data.get("notes", "")
            if sid not in self.by_id or verdict not in VERDICTS:
                raise ValueError("请选择当前片段的复核结论。")
            if not isinstance(alias, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,32}", alias):
                raise ValueError("教师代号请用 1–32 位字母、数字、下划线或短横线。")
            if not isinstance(notes, str) or len(notes) > 2000:
                raise ValueError("备注请控制在 2000 字以内。")
            if verdict != "PASS" and not notes.strip():
                raise ValueError("需核对或无法评审时，请写明原因。")
            for entry in entries:
                if entry["sample_id"] == sid:
                    entry.update(verdict=verdict, notes=notes, reviewer_alias=alias, reviewed_at=stamp())
            f = io.StringIO(newline="")
            writer = csv.DictWriter(f, fieldnames=FIELDS)
            writer.writeheader()
            writer.writerows(entries)
            self._atomic_csv(f.getvalue().encode("utf-8-sig"))
            return self.public()


class ReviewServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, store: ReviewStore, port: int = 8765):
        self.store = store
        super().__init__(("127.0.0.1", port), ReviewHandler)


class ReviewHandler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; "
                         "media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
        super().end_headers()

    def respond(self, status, value=b"", content_type="application/json; charset=utf-8", *, head=False):
        if not isinstance(value, bytes):
            value = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(value)))
        self.end_headers()
        if not head:
            self.wfile.write(value)

    def authorized(self):
        port = self.server.server_port
        if self.headers.get("Host") not in [f"127.0.0.1:{port}", f"localhost:{port}"]:
            self.respond(403, {"error": "Unsupported host"})
            return False
        access = self.server.store.access
        expected = "Basic " + base64.b64encode(f"{access['username']}:{access['password']}".encode()).decode()
        if not hmac.compare_digest(self.headers.get("Authorization", "").encode(), expected.encode()):
            self.send_response(401)
            self.send_header("WWW-Authenticate", 'Basic realm="Private teacher review", charset="UTF-8"')
            self.send_header("Content-Length", "0")
            self.end_headers()
            return False
        return True

    def do_HEAD(self):
        self.do_GET(head=True)

    def do_GET(self, head=False):
        if not self.authorized():
            return
        path = urlsplit(self.path).path
        store = self.server.store
        if path == "/api/packet":
            self.respond(200, store.public(), head=head)
        elif path == "/labels.csv":
            self.respond(200, store.csv.read_bytes(), "text/csv; charset=utf-8", head=head)
        elif path in ["/", "/review.js", "/review.css"]:
            name = "review.html" if path == "/" else path[1:]
            mime = {"review.html": "text/html", "review.js": "text/javascript", "review.css": "text/css"}[name]
            self.respond(200, (STATIC / name).read_bytes(), mime + "; charset=utf-8", head=head)
        elif path.startswith("/media/") and path[7:] in store.by_id:
            item = store.by_id[path[7:]]
            video = media_path(store.root, item["rel_video_path"], "videos")
            try:
                stream = video.open("rb")
            except OSError:
                self.respond(404, {"error": "Video unavailable"}, head=head)
                return
            try:
                with stream as f:
                    size = os.fstat(f.fileno()).st_size
                    start, end, partial = 0, size - 1, self.headers.get("Range")
                    if partial:
                        match = re.fullmatch(r"bytes=(\d*)-(\d*)", partial)
                        if not match or not any(match.groups()):
                            raise ValueError
                        a, b = match.groups()
                        if a:
                            start, end = int(a), min(int(b), size - 1) if b else size - 1
                        else:
                            start = max(0, size - int(b))
                        if start > end or end >= size or (not a and int(b) == 0):
                            raise ValueError
                    self.send_response(206 if partial else 200)
                    self.send_header("Content-Type", "video/mp4")
                    self.send_header("Accept-Ranges", "bytes")
                    self.send_header("Content-Length", str(end - start + 1))
                    if partial:
                        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
                    self.end_headers()
                    if not head:
                        f.seek(start)
                        remaining = end - start + 1
                        while remaining:
                            chunk = f.read(min(256 * 1024, remaining))
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                            remaining -= len(chunk)
            except ValueError:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
            except OSError:
                # A client may stop playback or the source file may be missing.
                self.close_connection = True
        else:
            self.respond(404, {"error": "Not found"}, head=head)

    def do_POST(self):
        if not self.authorized():
            return
        expected_origin = "http://" + self.headers["Host"]
        if self.headers.get("Origin") != expected_origin:
            self.respond(403, {"error": "Open the review page before saving"})
            return
        if urlsplit(self.path).path != "/api/labels":
            self.respond(404, {"error": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 16384 or self.headers.get("Content-Type") != "application/json":
                raise ValueError("Invalid request")
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError("Invalid request")
            result = self.server.store.save(data)
        except FileExistsError as e:
            self.respond(409, {"error": str(e)})
        except (ValueError, TypeError):
            self.respond(400, {"error": "请填写教师代号、复核结论，并为需核对或无法评审的片段写明原因。"})
        else:
            self.respond(200, result)


def main():
    os.umask(0o077)
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dataset-root", required=True, type=Path)
    p.add_argument("--packet", required=True, type=Path)
    p.add_argument("--state-dir", required=True, type=Path)
    p.add_argument("--port", default=8765, type=int)
    args = p.parse_args()
    store = ReviewStore(args.dataset_root, args.packet, args.state_dir)
    try:
        server = ReviewServer(store, args.port)
        print(f"Review: http://127.0.0.1:{server.server_port}", flush=True)
        print(f"Private login file: {store.state / 'access.json'}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
    finally:
        store.close()


if __name__ == "__main__":
    main()
