"""Boucle du worker de bout en bout, contre une API factice et un faux binaire whisper.

Aucun GPU, aucun réseau externe : un serveur HTTP local rejoue le contrat worker et
`fake_whisper.py` rejoue la sortie verbose du CLI.
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
    """Enregistre ce que le worker envoie et sert un job unique."""

    def __init__(self, jobs=(JOB,), lease_seconds=6):
        self.pending_jobs = list(jobs)
        self.lease_seconds = lease_seconds
        self.batches = []
        self.completed = []
        self.failed = []
        self.released = []
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
            WorkerConfig.from_environment(dict(base, POLL_INTERVAL_SECONDS="souvent"))


class StubClaims:
    """Client réduit à `claim` : rejoue les issues fournies, puis répète la dernière."""

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
    """Faux `threading.Event` : enregistre les sommeils au lieu de dormir.

    La boucle s'arrête après un nombre donné d'attentes, ce qui rend observable la
    cadence de sondage sans qu'une seule seconde ne s'écoule réellement.
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
    """Courbe du disjoncteur, éprouvée sur la fonction pure : aucun sommeil réel."""

    def test_keeps_the_nominal_interval_below_the_threshold(self):
        delays = [_claim_delay(3.0, failures, jitter=lambda: 1.0) for failures in range(1, 5)]

        self.assertEqual([3.0] * 4, delays)

    def test_doubles_the_interval_once_the_circuit_is_open_then_caps_it(self):
        delays = [_claim_delay(3.0, failures, jitter=lambda: 1.0) for failures in range(5, 11)]

        self.assertEqual([6.0, 12.0, 24.0, 48.0, 60.0, 60.0], delays)

    def test_never_leaves_the_interval_between_the_nominal_and_the_ceiling(self):
        # 2000 échecs : une API absente une journée entière ne doit ni déborder ni dépasser.
        for failures in (5, 20, 2000):
            for jitter in (lambda: 0.0, lambda: 0.5, random.random):
                delay = _claim_delay(3.0, failures, jitter=jitter)

                self.assertGreaterEqual(delay, 3.0)
                self.assertLessEqual(delay, CLAIM_BACKOFF_MAX_SECONDS)

    def test_a_poll_interval_wider_than_the_ceiling_is_left_alone(self):
        self.assertEqual(120.0, _claim_delay(120.0, 10, jitter=lambda: 1.0))


class ClaimCircuitLoopTest(unittest.TestCase):
    """Le disjoncteur dans la boucle : comptage, ouverture, remise à zéro, arrêt net."""

    def setUp(self):
        self.logs = io.StringIO()
        wisper_worker.configure_logging(self.logs)
        # Jitter figé : la cadence observée est reproductible d'une exécution à l'autre.
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
        # Cinq échecs ouvrent le circuit, une file vide (204) prouve que l'API répond.
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
        # Seuil abaissé à un échec : le premier tour part déjà sur une attente de 30 s ou plus.
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
        self.assertTrue(claimed.wait(5), "la boucle n'a jamais réclamé de job")

        stop.set()

        loop.join(timeout=5)
        self.assertFalse(loop.is_alive(), "l'arrêt a attendu la fin du sommeil du circuit ouvert")


class RecordingHeartbeats:
    """Client réduit au renouvellement de bail."""

    def __init__(self):
        self.renewals = []

    def heartbeat(self, run_id, transcription_id):
        self.renewals.append((run_id, transcription_id))


class FakeScheduler:
    """Ordonnanceur de battements piloté par le test : rien ne s'écoule sans `advance`.

    Vu du battement, c'est un `threading.Event` (`wait`, `set`) ; vu du test, c'est une
    fausse horloge. `advance` ne rend la main qu'une fois le battement reparti en attente,
    donc aucune assertion ne court après un thread.
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
        """Franchit un intervalle complet."""
        self._await_park("le battement n'attendait pas")
        self._resume.release()
        self._await_park("le battement n'est pas reparti en attente")
        self._parked.release()  # le jeton reste disponible pour le prochain `advance`

    def release(self, intervals):
        """Laisse filer des intervalles sans attendre personne : un survivant se ferait voir."""
        for _ in range(intervals):
            self._resume.release()

    def _await_park(self, message):
        if not self._parked.acquire(timeout=5.0):
            raise AssertionError(message)


class HeartbeatTest(unittest.TestCase):
    """Renouvellement du bail sur horloge injectée : aucun pari sur le temps réel."""

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
        # Deux intervalles franchis, un troisième en cours : toujours celui du bail.
        self.assertEqual([10.0] * 3, self.scheduler.waits)

    def test_stops_beating_as_soon_as_the_job_is_settled(self):
        self.beat.start()
        self.scheduler.advance()

        self.beat.stop()  # le job vient d'être conclu

        # `stop` joint le thread : plus personne n'est là pour franchir un intervalle.
        self.assertNotIn("wisper-heartbeat", [thread.name for thread in threading.enumerate()])
        self.scheduler.release(10)  # dix intervalles de plus, bien au-delà du bail
        self.assertEqual(1, len(self.client.renewals))
        self.assertEqual([10.0] * 2, self.scheduler.waits)


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
        # Un arrêt qui vient de nous n'est pas un échec du média : la tentative est rendue,
        # ce qui remet la demande en file tout de suite au lieu d'attendre l'expiration du bail.
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
    """Choix du device et du nombre de threads : la partie qui décide, sans GPU sous la main."""

    def _config(self, **overrides):
        base = {
            "WISPER_API_URL": "http://api.test",
            "WISPER_WORKER_TOKEN": "jeton-de-test",
        }
        base.update(overrides)
        return wisper_worker.WorkerConfig.from_environment(base)

    def test_auto_prend_la_carte_quand_elle_est_visible(self):
        config = wisper_worker.resolve_runtime(self._config(), probe=lambda _bin: True)

        self.assertEqual("cuda", config.resolved_device)

    def test_auto_reste_en_cpu_sans_carte(self):
        config = wisper_worker.resolve_runtime(self._config(), probe=lambda _bin: False)

        self.assertEqual("cpu", config.resolved_device)

    def test_un_device_explicite_ne_sonde_rien(self):
        def refuse(_bin):
            raise AssertionError("aucune sonde ne doit être lancée")

        for asked in ("cpu", "cuda"):
            config = wisper_worker.resolve_runtime(
                self._config(WISPER_DEVICE=asked), probe=refuse
            )
            self.assertEqual(asked, config.resolved_device)

    def test_un_device_inconnu_est_refuse(self):
        with self.assertRaises(wisper_worker.ConfigurationError):
            self._config(WISPER_DEVICE="metal")

    def test_les_threads_suivent_le_quota_du_conteneur(self):
        config = wisper_worker.resolve_runtime(
            self._config(), probe=lambda _bin: False, quota=lambda: 2
        )

        self.assertEqual(2, config.resolved_threads)

    def test_un_nombre_de_threads_explicite_gagne_sur_le_quota(self):
        config = wisper_worker.resolve_runtime(
            self._config(WISPER_THREADS="3"), probe=lambda _bin: False, quota=lambda: 8
        )

        self.assertEqual(3, config.resolved_threads)

    def test_le_quota_cgroup_v2_est_converti_en_coeurs(self):
        quota = wisper_worker.cpu_quota(read_text=lambda path: "200000 100000")

        self.assertEqual(2, quota)

    def test_un_quota_illimite_rend_les_coeurs_de_la_machine(self):
        quota = wisper_worker.cpu_quota(read_text=lambda path: "max 100000")

        self.assertEqual(os.cpu_count() or 1, quota)

    def test_un_cgroup_illisible_ne_fait_pas_echouer_le_worker(self):
        def missing(path):
            raise OSError("pas de cgroup ici")

        self.assertGreaterEqual(wisper_worker.cpu_quota(read_text=missing), 1)

    def test_la_commande_gpu_active_fp16_et_ne_borne_pas_les_threads(self):
        command = self._command(device="cuda")

        self.assertIn("--device", command)
        self.assertEqual("cuda", command[command.index("--device") + 1])
        self.assertEqual("True", command[command.index("--fp16") + 1])
        self.assertNotIn("--threads", command)

    def test_la_commande_cpu_desactive_fp16_et_borne_les_threads(self):
        command = self._command(device="cpu", threads=2)

        self.assertEqual("cpu", command[command.index("--device") + 1])
        self.assertEqual("False", command[command.index("--fp16") + 1])
        self.assertEqual("2", command[command.index("--threads") + 1])

    def _command(self, device, threads=1):
        """Capture la ligne de commande sans lancer whisper."""
        captured = {}

        class SilentClient:
            """Aucun segment ne sort de ce faux whisper : le client n'est jamais appelé."""

            def post_segments(self, *args, **kwargs):
                raise AssertionError("aucun segment attendu")


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
