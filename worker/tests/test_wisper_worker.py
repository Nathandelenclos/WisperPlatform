"""The worker loop end to end, against a stub API and a fake whisper binary.

No GPU, no external network: a local HTTP server replays the worker contract and
`fake_whisper.py` replays the verbose output of the CLI.
"""

import dataclasses
import io
import json
import os
import random
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import unittest.mock
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import wisper_worker
from api_client import ApiClient, ApiError
from wisper_worker import (
    CLAIM_BACKOFF_MAX_SECONDS,
    CLAIM_FAILURE_THRESHOLD,
    ConfigurationError,
    Heartbeat,
    WorkerConfig,
    _claim_delay,
    run_loop,
)

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
    """Records what the worker sends and serves a single job."""

    def __init__(self, jobs=(JOB,), lease_seconds=6):
        self.pending_jobs = list(jobs)
        self.lease_seconds = lease_seconds
        self.batches = []
        self.speakers = []
        # Status served by the speakers route: 422 replays a stale run.
        self.speakers_status = 204
        self.completed = []
        self.failed = []
        self.released = []
        self.heartbeats = 0
        self.media_tokens = []
        self.unauthorized = 0
        # Arrival order of the calls: this is what proves diarization comes before the job
        # is concluded.
        self.order = []
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
            self.order.append(name)
            if name == "batch":
                self.batches.append(value)
            elif name == "speakers":
                self.speakers.append(value)
            elif name == "heartbeat":
                self.heartbeats += 1
            elif name == "media":
                self.media_tokens.append(value)
            elif name == "completed":
                self.completed.append(value)
                self.settled.set()
            elif name == "released":
                self.released.append(value)
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
            pass  # no noise in the test output

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
            if self.path.endswith("/speakers"):
                stub.record("speakers", payload["turns"])
                return self._reply(stub.speakers_status)
            if self.path.endswith("/heartbeat"):
                stub.record("heartbeat")
                return self._reply(200, {"leaseExpiresAt": stub.lease()})
            if self.path.endswith("/complete"):
                stub.record("completed", payload["transcriptionId"])
                return self._reply(204)
            if self.path.endswith("/release"):
                stub.record("released", payload["transcriptionId"])
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
            WorkerConfig.from_environment(dict(base, POLL_INTERVAL_SECONDS="often"))


class StubClaims:
    """Client cut down to `claim`: replays the given outcomes, then repeats the last one."""

    def __init__(self, *outcomes):
        self._outcomes = list(outcomes)
        self.claims = 0

    def claim(self, worker_id, models):
        self.claims += 1
        outcome = self._outcomes[min(self.claims, len(self._outcomes)) - 1]
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome


class RecordingStop:
    """Fake `threading.Event`: records the sleeps instead of sleeping.

    The loop stops after a given number of waits, which makes the polling cadence observable
    without a single second actually elapsing.
    """

    def __init__(self, stop_after):
        self.waits = []
        self._stop_after = stop_after

    def is_set(self):
        return len(self.waits) >= self._stop_after

    def wait(self, timeout):
        self.waits.append(timeout)
        return self.is_set()


def loop_config(interval=3.0):
    return WorkerConfig.from_environment(
        {
            "WISPER_API_URL": "http://api.test",
            "WISPER_WORKER_TOKEN": "t",
            "WISPER_WORKER_ID": "test-worker",
            "POLL_INTERVAL_SECONDS": str(interval),
        }
    )


def unreachable_api():
    return ApiError("claim failed: URLError: refused", retryable=True)


class ClaimDelayTest(unittest.TestCase):
    """Curve of the circuit breaker, exercised on the pure function: no real sleep."""

    def test_keeps_the_nominal_interval_below_the_threshold(self):
        delays = [_claim_delay(3.0, failures, jitter=lambda: 1.0) for failures in range(1, 5)]

        self.assertEqual([3.0] * 4, delays)

    def test_doubles_the_interval_once_the_circuit_is_open_then_caps_it(self):
        delays = [_claim_delay(3.0, failures, jitter=lambda: 1.0) for failures in range(5, 11)]

        self.assertEqual([6.0, 12.0, 24.0, 48.0, 60.0, 60.0], delays)

    def test_never_leaves_the_interval_between_the_nominal_and_the_ceiling(self):
        # 2000 failures: an API missing for a whole day must neither overflow nor overshoot.
        for failures in (5, 20, 2000):
            for jitter in (lambda: 0.0, lambda: 0.5, random.random):
                delay = _claim_delay(3.0, failures, jitter=jitter)

                self.assertGreaterEqual(delay, 3.0)
                self.assertLessEqual(delay, CLAIM_BACKOFF_MAX_SECONDS)

    def test_a_poll_interval_wider_than_the_ceiling_is_left_alone(self):
        self.assertEqual(120.0, _claim_delay(120.0, 10, jitter=lambda: 1.0))


class ClaimCircuitLoopTest(unittest.TestCase):
    """The circuit breaker inside the loop: counting, opening, reset, clean stop."""

    def setUp(self):
        self.logs = io.StringIO()
        wisper_worker.configure_logging(self.logs)
        # Frozen jitter: the observed cadence is reproducible from one run to the next.
        random.seed(20260822)
        self.addCleanup(random.seed)

    def failure_events(self):
        events = [json.loads(line) for line in self.logs.getvalue().splitlines() if line.strip()]
        return [event for event in events if "consecutiveFailures" in event]

    def test_polls_at_the_nominal_cadence_while_the_circuit_is_closed(self):
        stop = RecordingStop(stop_after=CLAIM_FAILURE_THRESHOLD - 1)

        run_loop(loop_config(), StubClaims(unreachable_api()), stop)

        self.assertEqual([3.0] * 4, stop.waits)
        self.assertEqual([1, 2, 3, 4], [event["consecutiveFailures"] for event in self.failure_events()])

    def test_opens_the_circuit_beyond_the_threshold_without_exceeding_the_ceiling(self):
        stop = RecordingStop(stop_after=20)

        run_loop(loop_config(), StubClaims(unreachable_api()), stop)

        self.assertEqual([3.0] * 4, stop.waits[:4])
        self.assertTrue(all(delay > 3.0 for delay in stop.waits[4:]), stop.waits)
        self.assertLessEqual(max(stop.waits), CLAIM_BACKOFF_MAX_SECONDS)
        self.assertEqual(list(range(1, 21)), [event["consecutiveFailures"] for event in self.failure_events()])

    def test_closes_the_circuit_again_on_the_first_successful_claim(self):
        # Five failures open the circuit, an empty queue (204) proves the API answers.
        stop = RecordingStop(stop_after=7)
        claims = StubClaims(*([unreachable_api()] * 5), None, unreachable_api())

        run_loop(loop_config(), claims, stop)

        self.assertGreater(stop.waits[4], 3.0)
        self.assertEqual([3.0, 3.0], stop.waits[5:7])
        self.assertEqual([1, 2, 3, 4, 5, 1], [event["consecutiveFailures"] for event in self.failure_events()])

    def test_distinguishes_a_refused_token_from_a_transient_outage(self):
        stop = RecordingStop(stop_after=1)

        run_loop(loop_config(), StubClaims(ApiError("claim rejected with HTTP 401", status=401)), stop)

        rejection = self.failure_events()[0]
        self.assertEqual("claim rejected", rejection["message"])
        self.assertEqual("error", rejection["level"])
        self.assertEqual(401, rejection["status"])
        self.assertNotIn(WORKER_TOKEN, self.logs.getvalue())

    def test_counts_a_claim_response_that_breaks_the_contract_as_a_failure(self):
        stop = RecordingStop(stop_after=2)

        run_loop(loop_config(), StubClaims({"transcriptionId": "t-x"}), stop)

        self.assertEqual(
            ["claim response rejected"] * 2, [event["message"] for event in self.failure_events()]
        )
        self.assertEqual([1, 2], [event["consecutiveFailures"] for event in self.failure_events()])

    def test_a_stop_request_cuts_an_open_circuit_wait_short(self):
        # Threshold lowered to one failure: the very first round already waits 30 s or more.
        original = wisper_worker.CLAIM_FAILURE_THRESHOLD
        wisper_worker.CLAIM_FAILURE_THRESHOLD = 1
        self.addCleanup(setattr, wisper_worker, "CLAIM_FAILURE_THRESHOLD", original)
        claimed = threading.Event()

        class SlowlyFailing(StubClaims):
            def claim(self, worker_id, models):
                try:
                    return super().claim(worker_id, models)
                finally:
                    claimed.set()

        stop = threading.Event()
        loop = threading.Thread(
            target=run_loop, args=(loop_config(30.0), SlowlyFailing(unreachable_api()), stop), daemon=True
        )
        loop.start()
        self.assertTrue(claimed.wait(5), "the loop never claimed a job")

        stop.set()

        loop.join(timeout=5)
        self.assertFalse(loop.is_alive(), "the stop waited for the open-circuit sleep to finish")


class RecordingHeartbeats:
    """Client cut down to lease renewal."""

    def __init__(self):
        self.renewals = []

    def heartbeat(self, run_id, transcription_id):
        self.renewals.append((run_id, transcription_id))


class FakeScheduler:
    """Heartbeat scheduler driven by the test: nothing elapses without `advance`.

    Seen from the heartbeat it is a `threading.Event` (`wait`, `set`); seen from the test it is
    a fake clock. `advance` only returns once the heartbeat is back in its wait, so no
    assertion ever races a thread.
    """

    def __init__(self):
        self.waits = []
        self._parked = threading.Semaphore(0)
        self._resume = threading.Semaphore(0)
        self._stopped = False

    def wait(self, timeout):
        self.waits.append(timeout)
        self._parked.release()
        self._resume.acquire()
        return self._stopped

    def set(self):
        self._stopped = True
        self._resume.release()

    def advance(self):
        """Crosses one full interval."""
        self._await_park("the heartbeat was not waiting")
        self._resume.release()
        self._await_park("the heartbeat did not go back to waiting")
        self._parked.release()  # the token stays available for the next `advance`

    def release(self, intervals):
        """Lets intervals slip by without waiting for anyone: a survivor would show itself."""
        for _ in range(intervals):
            self._resume.release()

    def _await_park(self, message):
        if not self._parked.acquire(timeout=5.0):
            raise AssertionError(message)


class HeartbeatTest(unittest.TestCase):
    """Lease renewal on an injected clock: no bet on real time."""

    def setUp(self):
        wisper_worker.configure_logging(io.StringIO())
        self.client = RecordingHeartbeats()
        self.scheduler = FakeScheduler()
        self.beat = Heartbeat(
            self.client, JOB["runId"], JOB["transcriptionId"], 10.0, {}, scheduler=self.scheduler
        )
        self.addCleanup(self.beat.stop)

    def test_renews_the_lease_while_whisper_works(self):
        self.beat.start()

        self.scheduler.advance()
        self.scheduler.advance()

        self.assertEqual([(JOB["runId"], JOB["transcriptionId"])] * 2, self.client.renewals)
        # Two intervals crossed, a third under way: still the one from the lease.
        self.assertEqual([10.0] * 3, self.scheduler.waits)

    def test_stops_beating_as_soon_as_the_job_is_settled(self):
        self.beat.start()
        self.scheduler.advance()

        self.beat.stop()  # the job has just been concluded

        # `stop` joins the thread: nobody is left to cross an interval.
        self.assertNotIn("wisper-heartbeat", [thread.name for thread in threading.enumerate()])
        self.scheduler.release(10)  # ten more intervals, far beyond the lease
        self.assertEqual(1, len(self.client.renewals))
        self.assertEqual([10.0] * 2, self.scheduler.waits)


class WorkerLoopTest(unittest.TestCase):
    """The loop runs in a thread, against a real local HTTP server."""

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

    def run_worker(self, environment=None, timeout=30, diarizer=None):
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
        loop = threading.Thread(
            target=run_loop, args=(config, client, stop, diarizer), daemon=True
        )
        loop.start()
        self.assertTrue(self.stub.settled.wait(timeout), "the job never concluded")
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
            {"startMs": 0, "endMs": 2000, "text": "Segment number 1."}, self.stub.segments[0]
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
        # The already transcribed segments were published before the failure.
        self.assertEqual(2, len(self.stub.segments))
        self.assertEqual([], os.listdir(self.tmp_root))

    def test_a_failed_whisper_run_never_gets_diarized(self):
        # Diarizing a run that is heading for failure is wasted compute and, on a run already
        # re-queued, a burst of 422s: the pass must stay behind whisper's success.
        self.run_worker({"FAKE_WHISPER_FAIL": "1"}, diarizer=FakeDiarizer(TURNS))

        self.assertEqual(["whisper exited with code 3"], self.stub.failed)
        self.assertEqual([], self.stub.speakers)

    def test_logs_are_json_and_carry_no_secret_nor_transcript(self):
        self.run_worker()

        events = self.log_lines()
        self.assertEqual(
            ["worker started", "job claimed", "whisper started", "segments posted", "segments posted", "job completed", "worker stopped"],
            [event["message"] for event in events],
        )
        self.assertEqual({1, 2}, {event["batchSequence"] for event in events if "batchSequence" in event})
        raw = self.logs.getvalue()
        for forbidden in (WORKER_TOKEN, MEDIA_TOKEN, "Segment number", self.tmp_root):
            self.assertNotIn(forbidden, raw)

    def test_keeps_polling_when_the_queue_is_empty(self):
        self.stub.pending_jobs = []
        self.stub.settled.set()  # nothing to conclude: we stop after a few polls

        self.run_worker()

        self.assertEqual([], self.stub.completed)

    def test_survives_a_claim_response_that_breaks_the_contract(self):
        self.stub.pending_jobs = [{"transcriptionId": "t-x", "model": "tiny", "language": "fr"}, JOB]

        self.run_worker()

        self.assertEqual([JOB["transcriptionId"]], self.stub.completed)
        self.assertIn("claim response rejected", [event["message"] for event in self.log_lines()])

    def test_posts_the_speaker_turns_before_completing_the_job(self):
        self.run_worker(diarizer=FakeDiarizer(TURNS))

        self.assertEqual([TURNS], self.stub.speakers)
        self.assertEqual([JOB["transcriptionId"]], self.stub.completed)
        self.assertLess(self.stub.order.index("speakers"), self.stub.order.index("completed"))
        self.assertEqual(2, self._event("speakers posted")["turnCount"])

    def test_a_broken_diarization_never_costs_the_transcript(self):
        self.run_worker(diarizer=FakeDiarizer(error=RuntimeError("the engine melted down")))

        self.assertEqual([], self.stub.speakers)
        self.assertEqual([JOB["transcriptionId"]], self.stub.completed)
        self.assertEqual([], self.stub.failed)
        self.assertEqual(12, len(self.stub.segments))
        self.assertEqual("warning", self._event("diarization failed")["level"])
        # The detail is reduced to the type: a third-party library's message may carry a
        # media path, which has no business being in the log.
        self.assertNotIn("melted", self.logs.getvalue())

    def test_a_rejected_speakers_call_never_costs_the_transcript(self):
        self.stub.speakers_status = 422  # run stale on the API side

        self.run_worker(diarizer=FakeDiarizer(TURNS))

        self.assertEqual([JOB["transcriptionId"]], self.stub.completed)
        self.assertEqual([], self.stub.failed)
        self.assertEqual("warning", self._event("diarization failed")["level"])

    def test_the_lease_keeps_beating_during_the_diarization_pass(self):
        # One heartbeat per second: the pass waits to see one before handing back control.
        self.stub.lease_seconds = 3
        beaten = threading.Event()

        def wait_for_a_beat():
            already = self.stub.heartbeats
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline and self.stub.heartbeats == already:
                time.sleep(0.05)
            if self.stub.heartbeats > already:
                beaten.set()

        self.run_worker(diarizer=FakeDiarizer(TURNS, before=wait_for_a_beat))

        self.assertTrue(beaten.is_set(), "the lease stopped beating during diarization")
        self.assertEqual([JOB["transcriptionId"]], self.stub.completed)

    def _event(self, message):
        for event in self.log_lines():
            if event["message"] == message:
                return event
        self.fail("event missing from the log: " + message)


TURNS = [
    {"startMs": 0, "endMs": 2000, "speaker": 0},
    {"startMs": 2000, "endMs": 4000, "speaker": 1},
]


class FakeDiarizer:
    """Diarizer driven by the test: returns turns, or breaks, without model or audio."""

    def __init__(self, turns=(), error=None, before=None):
        self.turns = list(turns)
        self.error = error
        self.before = before
        self.calls = []

    def run(self, media_path, workdir):
        self.calls.append((media_path, workdir))
        if self.before is not None:
            self.before()
        if self.error is not None:
            raise self.error
        return self.turns


class RecordingSpeakers:
    """Client cut down to publishing the turns."""

    def __init__(self, error=None):
        self.posted = []
        self.error = error

    def post_speakers(self, run_id, transcription_id, turns):
        self.posted.append((run_id, transcription_id, turns))
        if self.error is not None:
            raise self.error


class DiarizationPassTest(unittest.TestCase):
    """The pass is optional: what matters is when it is skipped, and at what price."""

    def setUp(self):
        self.logs = io.StringIO()
        wisper_worker.configure_logging(self.logs)
        self.client = RecordingSpeakers()
        self.stop = threading.Event()

    def _diarize(self, diarizer):
        wisper_worker._diarize(self.client, diarizer, JOB, "media", "workdir", self.stop, {})

    def test_a_worker_without_the_capability_does_nothing_and_says_nothing(self):
        self._diarize(None)

        self.assertEqual([], self.client.posted)
        self.assertEqual("", self.logs.getvalue())

    def test_a_requested_stop_skips_the_pass(self):
        self.stop.set()
        diarizer = FakeDiarizer(TURNS)

        self._diarize(diarizer)

        self.assertEqual([], diarizer.calls)
        self.assertEqual([], self.client.posted)

    def test_a_pass_without_any_turn_is_published_all_the_same(self):
        # Replay: an assignment left by a previous attempt must disappear if this pass no
        # longer finds anyone. The API recomputes from whatever we send it.
        self._diarize(FakeDiarizer([]))

        self.assertEqual([(JOB["runId"], JOB["transcriptionId"], [])], self.client.posted)

    def test_a_publication_failure_never_surfaces(self):
        self.client.error = ApiError("speakers rejected with HTTP 422", status=422)

        self._diarize(FakeDiarizer(TURNS))

        self.assertIn("diarization failed", self.logs.getvalue())


class SigtermTest(unittest.TestCase):
    """The worker launched as a real process must stop cleanly on SIGTERM."""

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

        self._wait_for(lambda: os.listdir(tmp_root), "the working directory was never created")
        process.send_signal(signal.SIGTERM)

        self.assertEqual(0, process.wait(timeout=30))
        self.assertEqual([], os.listdir(tmp_root), "the temporary directory survived the SIGTERM")
        # A stop that comes from us is not a media failure: the attempt is released, which
        # re-queues the request right away instead of waiting for the lease to expire.
        self.assertEqual([], stub.failed)
        self.assertEqual([JOB["transcriptionId"]], stub.released)
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


class DeviceResolutionTest(unittest.TestCase):
    """Device and thread-count choice: the deciding part, with no GPU at hand."""

    def _config(self, **overrides):
        base = {
            "WISPER_API_URL": "http://api.test",
            "WISPER_WORKER_TOKEN": "test-token",
        }
        base.update(overrides)
        return wisper_worker.WorkerConfig.from_environment(base)

    def test_auto_takes_the_card_when_it_is_visible(self):
        config = wisper_worker.resolve_runtime(self._config(), probe=lambda _bin: True)

        self.assertEqual("cuda", config.resolved_device)

    def test_auto_stays_on_cpu_without_a_card(self):
        config = wisper_worker.resolve_runtime(self._config(), probe=lambda _bin: False)

        self.assertEqual("cpu", config.resolved_device)

    def test_an_explicit_device_probes_nothing(self):
        def refuse(_bin):
            raise AssertionError("no probe must be launched")

        for asked in ("cpu", "cuda"):
            config = wisper_worker.resolve_runtime(
                self._config(WISPER_DEVICE=asked), probe=refuse
            )
            self.assertEqual(asked, config.resolved_device)

    def test_an_unknown_device_is_refused(self):
        with self.assertRaises(wisper_worker.ConfigurationError):
            self._config(WISPER_DEVICE="metal")

    def test_the_threads_follow_the_container_quota(self):
        config = wisper_worker.resolve_runtime(
            self._config(), probe=lambda _bin: False, quota=lambda: 2
        )

        self.assertEqual(2, config.resolved_threads)

    def test_an_explicit_thread_count_wins_over_the_quota(self):
        config = wisper_worker.resolve_runtime(
            self._config(WISPER_THREADS="3"), probe=lambda _bin: False, quota=lambda: 8
        )

        self.assertEqual(3, config.resolved_threads)

    def test_the_cgroup_v2_quota_is_converted_into_cores(self):
        quota = wisper_worker.cpu_quota(read_text=lambda path: "200000 100000")

        self.assertEqual(2, quota)

    def test_an_unlimited_quota_returns_the_machine_cores(self):
        quota = wisper_worker.cpu_quota(read_text=lambda path: "max 100000")

        self.assertEqual(os.cpu_count() or 1, quota)

    def test_an_unreadable_cgroup_does_not_fail_the_worker(self):
        def missing(path):
            raise OSError("no cgroup here")

        self.assertGreaterEqual(wisper_worker.cpu_quota(read_text=missing), 1)

    def test_the_gpu_command_enables_fp16_and_does_not_bound_the_threads(self):
        command = self._command(device="cuda")

        self.assertIn("--device", command)
        self.assertEqual("cuda", command[command.index("--device") + 1])
        self.assertEqual("True", command[command.index("--fp16") + 1])
        self.assertNotIn("--threads", command)

    def test_the_cpu_command_disables_fp16_and_bounds_the_threads(self):
        command = self._command(device="cpu", threads=2)

        self.assertEqual("cpu", command[command.index("--device") + 1])
        self.assertEqual("False", command[command.index("--fp16") + 1])
        self.assertEqual("2", command[command.index("--threads") + 1])

    def _command(self, device, threads=1):
        """Captures the command line without launching whisper."""
        captured = {}

        class SilentClient:
            """No segment comes out of this fake whisper: the client is never called."""

            def post_segments(self, *args, **kwargs):
                raise AssertionError("no segment expected")


        class FakePopen:
            def __init__(self, command, **kwargs):
                captured["command"] = command
                self.stdout = io.StringIO("")
                self.stderr = io.StringIO("")
                self.returncode = 0

            def wait(self, timeout=None):
                return 0

            def poll(self):
                return 0

            def terminate(self):
                pass

            def kill(self):
                pass

        config = dataclasses.replace(
            self._config(), resolved_device=device, resolved_threads=threads
        )
        job = {"model": "small", "language": "French", "transcriptionId": "t", "runId": "r"}
        with tempfile.TemporaryDirectory() as workdir:
            with unittest.mock.patch.object(wisper_worker.subprocess, "Popen", FakePopen):
                wisper_worker._run_whisper(
                    config,
                    SilentClient(),
                    job,
                    os.path.join(workdir, "media"),
                    workdir,
                    threading.Event(),
                    {},
                )
        return captured["command"]
