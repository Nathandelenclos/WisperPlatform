"""Boucle du worker de bout en bout, contre une API factice et un faux binaire whisper.

Aucun GPU, aucun réseau externe : un serveur HTTP local rejoue le contrat worker et
`fake_whisper.py` rejoue la sortie verbose du CLI.
"""

import io
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import wisper_worker
from api_client import ApiClient
from wisper_worker import ConfigurationError, WorkerConfig, run_loop

FAKE_WHISPER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fake_whisper.py")
WORKER_SCRIPT = os.path.join(wisper_worker.__file__)
WORKER_TOKEN = "worker-shared-token"
MEDIA_TOKEN = "media-token-value"
MEDIA_BYTES = b"pretend-this-is-an-audio-file"
JOB = {
    "transcriptionId": "3f1a0c8e-0000-4000-8000-000000000001",
    "runId": "3f1a0c8e-0000-4000-8000-000000000002",
    "model": "tiny",
    "language": "fr",
    "mediaToken": MEDIA_TOKEN,
}


class StubApi:
    """Enregistre ce que le worker envoie et sert un job unique."""

    def __init__(self, jobs=(JOB,), lease_seconds=6):
        self.pending_jobs = list(jobs)
        self.lease_seconds = lease_seconds
        self.batches = []
        self.completed = []
        self.failed = []
        self.heartbeats = 0
        self.media_tokens = []
        self.unauthorized = 0
        self.settled = threading.Event()
        self._server = None
        self._lock = threading.Lock()

    @property
    def url(self):
        return "http://127.0.0.1:{}".format(self._server.server_address[1])

    @property
    def segments(self):
        return [segment for _, batch in self.batches for segment in batch]

    def lease(self):
        return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(time.time() + self.lease_seconds)) + ".000Z"

    def start(self):
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), _handler_for(self))
        threading.Thread(target=self._server.serve_forever, daemon=True).start()
        return self

    def stop(self):
        self._server.shutdown()
        self._server.server_close()

    def record(self, name, value=None):
        with self._lock:
            if name == "batch":
                self.batches.append(value)
            elif name == "heartbeat":
                self.heartbeats += 1
            elif name == "media":
                self.media_tokens.append(value)
            elif name == "completed":
                self.completed.append(value)
                self.settled.set()
            elif name == "failed":
                self.failed.append(value)
                self.settled.set()

    def take_job(self):
        with self._lock:
            return self.pending_jobs.pop(0) if self.pending_jobs else None


def _handler_for(stub):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *_):
            pass  # pas de bruit dans la sortie des tests

        def _authorized(self):
            if self.headers.get("Authorization") == "Bearer " + WORKER_TOKEN:
                return True
            stub.unauthorized += 1
            self._reply(401)
            return False

        def _reply(self, status, payload=None):
            body = b"" if payload is None else json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Length", str(len(body)))
            if body:
                self.send_header("Content-Type", "application/json")
            self.end_headers()
            if body:
                self.wfile.write(body)

        def do_GET(self):
            if not self._authorized():
                return
            if self.path.startswith("/api/worker/media/"):
                stub.record("media", self.path.rsplit("/", 1)[1])
                self.send_response(200)
                self.send_header("Content-Length", str(len(MEDIA_BYTES)))
                self.end_headers()
                self.wfile.write(MEDIA_BYTES)
                return
            self._reply(404)

        def do_POST(self):
            if not self._authorized():
                return
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(length) or b"{}")
            if self.path == "/api/worker/jobs/claim":
                job = stub.take_job()
                if job is None:
                    return self._reply(204)
                return self._reply(200, dict(job, leaseExpiresAt=stub.lease()))
            if self.path.endswith("/segments"):
                stub.record("batch", (payload["batchSequence"], payload["segments"]))
                return self._reply(204)
            if self.path.endswith("/heartbeat"):
                stub.record("heartbeat")
                return self._reply(200, {"leaseExpiresAt": stub.lease()})
            if self.path.endswith("/complete"):
                stub.record("completed", payload["transcriptionId"])
                return self._reply(204)
            if self.path.endswith("/fail"):
                stub.record("failed", payload["reason"])
                return self._reply(204)
            self._reply(404)

    return Handler


class ConfigTest(unittest.TestCase):
    def test_rejects_a_missing_url_or_token(self):
        with self.assertRaises(ConfigurationError):
            WorkerConfig.from_environment({"WISPER_WORKER_TOKEN": "t"})
        with self.assertRaises(ConfigurationError):
            WorkerConfig.from_environment({"WISPER_API_URL": "http://api.test", "WISPER_WORKER_TOKEN": "  "})

    def test_serves_every_model_by_default(self):
        config = WorkerConfig.from_environment({"WISPER_API_URL": "http://api.test", "WISPER_WORKER_TOKEN": "t"})

        self.assertEqual(wisper_worker.WHISPER_MODELS, config.models)
        self.assertEqual("local-worker", config.worker_id)
        self.assertEqual(3.0, config.poll_interval_seconds)

    def test_restricts_the_served_models(self):
        config = WorkerConfig.from_environment(
            {"WISPER_API_URL": "http://api.test", "WISPER_WORKER_TOKEN": "t", "WISPER_WORKER_MODELS": "tiny, large"}
        )

        self.assertEqual(("tiny", "large"), config.models)

    def test_rejects_an_unknown_model_or_a_bad_interval(self):
        base = {"WISPER_API_URL": "http://api.test", "WISPER_WORKER_TOKEN": "t"}
        with self.assertRaises(ConfigurationError):
            WorkerConfig.from_environment(dict(base, WISPER_WORKER_MODELS="enormous"))
        with self.assertRaises(ConfigurationError):
            WorkerConfig.from_environment(dict(base, POLL_INTERVAL_SECONDS="0"))
        with self.assertRaises(ConfigurationError):
            WorkerConfig.from_environment(dict(base, POLL_INTERVAL_SECONDS="souvent"))


class WorkerLoopTest(unittest.TestCase):
    """La boucle tourne dans un thread, contre un vrai serveur HTTP local."""

    def setUp(self):
        self.logs = io.StringIO()
        wisper_worker.configure_logging(self.logs)
        self.tmp_root = tempfile.mkdtemp(prefix="wisper-tests-")
        self.previous_tempdir = tempfile.tempdir
        tempfile.tempdir = self.tmp_root
        self.stub = StubApi().start()
        self.addCleanup(self._restore)

    def _restore(self):
        tempfile.tempdir = self.previous_tempdir
        self.stub.stop()
        shutil.rmtree(self.tmp_root, ignore_errors=True)

    def run_worker(self, environment=None, timeout=30):
        for name, value in (environment or {}).items():
            os.environ[name] = value
            self.addCleanup(os.environ.pop, name, None)
        config = WorkerConfig.from_environment(
            {
                "WISPER_API_URL": self.stub.url,
                "WISPER_WORKER_TOKEN": WORKER_TOKEN,
                "WISPER_WORKER_ID": "test-worker",
                "WHISPER_BIN": FAKE_WHISPER,
                "POLL_INTERVAL_SECONDS": "0.05",
            }
        )
        stop = threading.Event()
        client = ApiClient(config.api_url, config.worker_token)
        loop = threading.Thread(target=run_loop, args=(config, client, stop), daemon=True)
        loop.start()
        self.assertTrue(self.stub.settled.wait(timeout), "le job ne s'est jamais conclu")
        stop.set()
        loop.join(timeout=timeout)
        self.assertFalse(loop.is_alive())

    def log_lines(self):
        return [json.loads(line) for line in self.logs.getvalue().splitlines() if line.strip()]

    def test_streams_every_segment_then_completes_the_job(self):
        self.run_worker()

        self.assertEqual([JOB["transcriptionId"]], self.stub.completed)
        self.assertEqual([], self.stub.failed)
        self.assertEqual([MEDIA_TOKEN], self.stub.media_tokens)
        self.assertEqual([1, 2], [sequence for sequence, _ in self.stub.batches])
        self.assertEqual([10, 2], [len(batch) for _, batch in self.stub.batches])
        self.assertEqual(12, len(self.stub.segments))
        self.assertEqual(
            {"startMs": 0, "endMs": 2000, "text": "Segment numero 1."}, self.stub.segments[0]
        )
        self.assertEqual(22000, self.stub.segments[-1]["startMs"])
        self.assertEqual(0, self.stub.unauthorized)

    def test_removes_the_temporary_directory_when_the_job_is_done(self):
        self.run_worker()

        self.assertEqual([], os.listdir(self.tmp_root))

    def test_reports_a_short_failure_when_whisper_exits_non_zero(self):
        self.run_worker({"FAKE_WHISPER_FAIL": "1"})

        self.assertEqual(["whisper exited with code 3"], self.stub.failed)
        self.assertEqual([], self.stub.completed)
        # Les segments déjà transcrits ont été publiés avant l'échec.
        self.assertEqual(2, len(self.stub.segments))
        self.assertEqual([], os.listdir(self.tmp_root))

    def test_logs_are_json_and_carry_no_secret_nor_transcript(self):
        self.run_worker()

        events = self.log_lines()
        self.assertEqual(
            ["worker started", "job claimed", "whisper started", "segments posted", "segments posted", "job completed", "worker stopped"],
            [event["message"] for event in events],
        )
        self.assertEqual({1, 2}, {event["batchSequence"] for event in events if "batchSequence" in event})
        raw = self.logs.getvalue()
        for forbidden in (WORKER_TOKEN, MEDIA_TOKEN, "Segment numero", self.tmp_root):
            self.assertNotIn(forbidden, raw)

    def test_keeps_polling_when_the_queue_is_empty(self):
        self.stub.pending_jobs = []
        self.stub.settled.set()  # rien à conclure : on arrête après quelques sondages

        self.run_worker()

        self.assertEqual([], self.stub.completed)

    def test_survives_a_claim_response_that_breaks_the_contract(self):
        self.stub.pending_jobs = [{"transcriptionId": "t-x", "model": "tiny", "language": "fr"}, JOB]

        self.run_worker()

        self.assertEqual([JOB["transcriptionId"]], self.stub.completed)
        self.assertIn("claim response rejected", [event["message"] for event in self.log_lines()])

    def test_renews_the_lease_while_whisper_works_then_stops_beating(self):
        self.stub.lease_seconds = 3  # bail court : un battement par seconde

        self.run_worker({"FAKE_WHISPER_HANG_SECONDS": "2.5"})

        self.assertGreaterEqual(self.stub.heartbeats, 2)
        settled = self.stub.heartbeats
        time.sleep(1.5)
        self.assertEqual(settled, self.stub.heartbeats, "le battement a survécu au job")


class SigtermTest(unittest.TestCase):
    """Le worker lancé comme un vrai processus doit s'arrêter proprement sur SIGTERM."""

    def test_stops_the_run_and_removes_its_temporary_directory(self):
        stub = StubApi(lease_seconds=120).start()
        tmp_root = tempfile.mkdtemp(prefix="wisper-sigterm-")
        self.addCleanup(shutil.rmtree, tmp_root, ignore_errors=True)
        self.addCleanup(stub.stop)
        environment = dict(
            os.environ,
            TMPDIR=tmp_root,
            WISPER_API_URL=stub.url,
            WISPER_WORKER_TOKEN=WORKER_TOKEN,
            WISPER_WORKER_ID="sigterm-worker",
            WHISPER_BIN=FAKE_WHISPER,
            POLL_INTERVAL_SECONDS="0.05",
            FAKE_WHISPER_HANG_SECONDS="60",
        )
        process = subprocess.Popen(
            [sys.executable, WORKER_SCRIPT],
            env=environment,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        self.addCleanup(process.kill)
        self.addCleanup(process.stdout.close)

        self._wait_for(lambda: os.listdir(tmp_root), "le répertoire de travail n'a jamais été créé")
        process.send_signal(signal.SIGTERM)

        self.assertEqual(0, process.wait(timeout=30))
        self.assertEqual([], os.listdir(tmp_root), "le répertoire temporaire a survécu au SIGTERM")
        self.assertEqual(["worker stopped"], stub.failed)
        self.assertNotIn(WORKER_TOKEN, process.stdout.read())

    def _wait_for(self, condition, message, timeout=30):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if condition():
                return
            time.sleep(0.05)
        self.fail(message)


if __name__ == "__main__":
    unittest.main()
