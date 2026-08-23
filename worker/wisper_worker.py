#!/usr/bin/env python3
"""WisperPlatform transcription worker.

Loop: claim a job → download the media → run the `whisper` binary → publish segments as they
come → conclude (`complete` / `fail`) → erase the temporary directory.

Standard library only. `whisper` runs as a subprocess, from an argument list, never through a
shell, never imported.

The worker learns nothing about the user: it receives a short-lived media token, writes the
media under a neutral name, and logs neither token, nor filename, nor transcribed text — only
technical identifiers and counters.
"""

from __future__ import annotations

import collections
import dataclasses
import json
import logging
import os
import queue
import random
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone

import diarization
from api_client import ApiClient, ApiError
from whisper_output import SegmentBatcher, parse_segment_line

# Models from the contract (`WHISPER_MODELS` on the domain side).
WHISPER_MODELS = ("tiny", "base", "small", "medium", "large", "turbo")
LANGUAGE_PATTERN = re.compile(r"^[A-Za-z]{2,32}$")

# Hard bound on a job: past it, the subprocess is stopped and the job declared failed.
WHISPER_TIMEOUT_SECONDS = 6 * 60 * 60
# Grace left to `whisper` to exit after `terminate`, before `kill`.
TERMINATE_GRACE_SECONDS = 10.0
# Wake-up period of the read loop: bounds how fast a requested shutdown is honoured.
LOOP_TICK_SECONDS = 0.5
# Unusable lease (missing or unreadable): cautious fallback to a frequent heartbeat.
FALLBACK_HEARTBEAT_SECONDS = 20.0
# Circuit breaker of the claim loop: past this number of consecutive `claim` failures the
# circuit opens and the polling interval grows up to its ceiling. A successful `claim` — job
# served or empty queue — closes the circuit again.
CLAIM_FAILURE_THRESHOLD = 5
CLAIM_BACKOFF_MAX_SECONDS = 60.0
# Neutral name of the media on disk: the original name never leaves the API.
MEDIA_FILENAME = "media"

# Number of stderr lines kept to explain a failure: enough for a Python traceback, too few to
# retain a whole transcript.
STDERR_TAIL_LINES = 40

# Internal reason: the shutdown comes from the worker itself, never from the media or the API.
STOPPED_REASON = "worker stopped"

LOGGER = logging.getLogger("wisper.worker")


class ConfigurationError(Exception):
    """Missing or invalid environment configuration."""


@dataclasses.dataclass(frozen=True)
class WorkerConfig:
    api_url: str
    worker_token: str
    worker_id: str
    whisper_bin: str
    model_dir: str
    models: tuple
    poll_interval_seconds: float
    device: str
    threads: int
    # Resolved once at startup by `resolve_runtime`, never per job: probing the card costs
    # an interpreter startup.
    resolved_device: str = "cpu"
    resolved_threads: int = 1

    @staticmethod
    def from_environment(environ):
        api_url = (environ.get("WISPER_API_URL") or "").strip()
        if not api_url:
            raise ConfigurationError("WISPER_API_URL is required")
        worker_token = environ.get("WISPER_WORKER_TOKEN") or ""
        if not worker_token.strip():
            raise ConfigurationError("WISPER_WORKER_TOKEN is required")
        return WorkerConfig(
            api_url=api_url,
            worker_token=worker_token,
            worker_id=(environ.get("WISPER_WORKER_ID") or "").strip() or "local-worker",
            whisper_bin=(environ.get("WHISPER_BIN") or "").strip() or "whisper",
            model_dir=(environ.get("WHISPER_MODEL_DIR") or "").strip(),
            models=_parse_models(environ.get("WISPER_WORKER_MODELS")),
            poll_interval_seconds=_parse_poll_interval(environ.get("POLL_INTERVAL_SECONDS")),
            device=_parse_device(environ.get("WISPER_DEVICE")),
            threads=_parse_threads(environ.get("WISPER_THREADS")),
        )


def _parse_models(raw):
    if not raw or not raw.strip():
        return WHISPER_MODELS
    models = tuple(model.strip() for model in raw.split(",") if model.strip())
    unknown = [model for model in models if model not in WHISPER_MODELS]
    if not models or unknown:
        raise ConfigurationError(
            "WISPER_WORKER_MODELS only accepts: " + ", ".join(WHISPER_MODELS)
        )
    return models


DEVICES = ("auto", "cpu", "cuda")


def _parse_device(raw):
    device = (raw or "").strip().lower() or "auto"
    if device not in DEVICES:
        raise ConfigurationError("WISPER_DEVICE only accepts: " + ", ".join(DEVICES))
    return device


def _parse_threads(raw):
    """0 = infer from the container CPU quota."""
    if raw is None or not raw.strip():
        return 0
    try:
        threads = int(raw)
    except ValueError:
        raise ConfigurationError("WISPER_THREADS must be an integer") from None
    if threads < 0:
        raise ConfigurationError("WISPER_THREADS must be zero or positive")
    return threads


def cpu_quota(read_text=None):
    """
    Number of actually usable cores, read from the cgroup rather than from the machine.
    Without that bound, torch opens as many threads as the host has cores while the container
    only has two: the threads fight over the quota and inference gets SLOWER.
    """
    if read_text is None:
        def read_text(path):
            with open(path, "r", encoding="utf-8") as handle:
                return handle.read()
    for path, parse in (("/sys/fs/cgroup/cpu.max", _quota_v2), ("/sys/fs/cgroup/cpu/cpu.cfs_quota_us", _quota_v1)):
        try:
            quota = parse(read_text, path)
        except (OSError, ValueError):
            continue
        if quota:
            return quota
    return os.cpu_count() or 1


def _quota_v2(read_text, path):
    quota, period = read_text(path).split()[:2]
    if quota == "max":
        return None
    return max(1, int(float(quota) / float(period)))


def _quota_v1(read_text, path):
    quota = int(read_text(path).strip())
    if quota <= 0:
        return None
    period = int(read_text("/sys/fs/cgroup/cpu/cpu.cfs_period_us").strip())
    return max(1, quota // period)


def resolve_device(config, probe=None):
    """
    `auto` asks whisper's own torch once: it is the one that knows whether a card is visible
    inside the container. A missing card is not an error, we stay on CPU.
    """
    if config.device != "auto":
        return config.device
    if probe is None:
        probe = _probe_cuda
    return "cuda" if probe(config.whisper_bin) else "cpu"


def _probe_cuda(whisper_bin):
    interpreter = os.path.join(os.path.dirname(os.path.abspath(whisper_bin)), "python")
    for candidate in (interpreter, sys.executable):
        try:
            result = subprocess.run(
                [candidate, "-c", "import torch;print(int(torch.cuda.is_available()))"],
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                timeout=60,
            )
        except (OSError, subprocess.SubprocessError):
            continue
        if result.returncode == 0:
            return result.stdout.strip().endswith("1")
    return False


def resolve_runtime(config, probe=None, quota=None):
    """Settles this worker's device and thread count once and for all."""
    device = resolve_device(config, probe)
    threads = config.threads or (quota or cpu_quota)()
    return dataclasses.replace(config, resolved_device=device, resolved_threads=max(1, threads))


def _parse_poll_interval(raw):
    if raw is None or not raw.strip():
        return 3.0
    try:
        interval = float(raw)
    except ValueError:
        raise ConfigurationError("POLL_INTERVAL_SECONDS must be a number of seconds") from None
    if interval <= 0:
        raise ConfigurationError("POLL_INTERVAL_SECONDS must be strictly positive")
    return interval


class JsonFormatter(logging.Formatter):
    """One JSON line per event. No secrets, no personal data."""

    def format(self, record):
        event = {
            "time": datetime.fromtimestamp(record.created, timezone.utc)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
            "level": record.levelname.lower(),
            "component": "worker",
            "message": record.getMessage(),
        }
        fields = getattr(record, "fields", None)
        if fields:
            event.update(fields)
        return json.dumps(event, ensure_ascii=False, sort_keys=True)


def configure_logging(stream=None):
    handler = logging.StreamHandler(stream if stream is not None else sys.stdout)
    handler.setFormatter(JsonFormatter())
    LOGGER.handlers = [handler]
    LOGGER.setLevel(logging.INFO)
    LOGGER.propagate = False
    return LOGGER


def log(level, message, **fields):
    LOGGER.log(level, message, extra={"fields": fields})


def run_loop(config, client, stop, diarizer=None):
    """Claims and processes jobs until `stop` is armed.

    The circuit breaker lives here: `failures` counts consecutively lost `claim` calls and
    spreads out the polls once the threshold is crossed, so as not to hammer an API that is
    trying to get back up. Waiting always goes through `stop.wait`, never through `sleep`: a
    requested shutdown cuts it short, open circuit or not.
    """
    log(
        logging.INFO,
        "worker started",
        workerId=config.worker_id,
        models=list(config.models),
        device=config.resolved_device,
        threads=config.resolved_threads,
    )
    failures = 0
    while not stop.is_set():
        try:
            job = client.claim(config.worker_id, config.models)
        except ApiError as error:
            failures += 1
            delay = _claim_delay(config.poll_interval_seconds, failures)
            # A definitive 4xx — token refused, unknown worker — is not a transient outage:
            # it will not heal on its own, the operator has to tell it apart.
            # `str(error)` carries only the operation and the status, never the URL or the token.
            log(
                logging.WARNING if error.retryable else logging.ERROR,
                "claim failed" if error.retryable else "claim rejected",
                workerId=config.worker_id,
                status=error.status,
                detail=str(error),
                consecutiveFailures=failures,
                retryInSeconds=round(delay, 3),
            )
            stop.wait(delay)
            continue
        if job is None:
            # Empty queue: the API answered, the circuit closes again.
            failures = 0
            stop.wait(config.poll_interval_seconds)
            continue
        if not _is_usable_job(job):
            # Off-contract response: we can neither process it nor declare it failed.
            # An API that no longer honours the contract is down: it opens the circuit.
            failures += 1
            delay = _claim_delay(config.poll_interval_seconds, failures)
            log(
                logging.ERROR,
                "claim response rejected",
                workerId=config.worker_id,
                consecutiveFailures=failures,
                retryInSeconds=round(delay, 3),
            )
            stop.wait(delay)
            continue
        failures = 0
        process_job(config, client, job, stop, diarizer)
    log(logging.INFO, "worker stopped", workerId=config.worker_id)


def _claim_delay(interval, failures, jitter=random.random):
    """Delay before the next `claim`, based on the number of consecutive failures.

    Closed circuit: the nominal interval. Open: it doubles with every extra failure up to the
    ceiling, and the jitter spreads workers restarted together between the nominal value and
    that ceiling — otherwise they would all fall back on the API on the very same second.
    """
    if failures < CLAIM_FAILURE_THRESHOLD:
        return interval
    # The exponent is bounded: an API missing for a whole day must not overflow the float,
    # and the ceiling is reached within a few failures anyway.
    doublings = min(failures - CLAIM_FAILURE_THRESHOLD + 1, 32)
    ceiling = max(interval, min(interval * 2**doublings, CLAIM_BACKOFF_MAX_SECONDS))
    return interval + (ceiling - interval) * jitter()


def _is_usable_job(job):
    """Fields without which no action is possible, not even reporting the failure."""
    return isinstance(job, dict) and all(
        isinstance(job.get(name), str) and job[name]
        for name in ("transcriptionId", "runId", "mediaToken")
    )


def process_job(config, client, job, stop, diarizer=None):
    run_id = job["runId"]
    transcription_id = job["transcriptionId"]
    fields = {
        "workerId": config.worker_id,
        "transcriptionId": transcription_id,
        "runId": run_id,
        "model": job.get("model"),
    }
    log(logging.INFO, "job claimed", **fields)
    workdir = tempfile.mkdtemp(prefix="wisper-worker-")
    heartbeat = Heartbeat(client, run_id, transcription_id, _heartbeat_interval(job), fields)
    try:
        # The lease runs from the claim onwards: the heartbeat covers the download too.
        heartbeat.start()
        reason = _reject_unsupported(job)
        if reason is None:
            media_path = os.path.join(workdir, MEDIA_FILENAME)
            client.download_media(job["mediaToken"], media_path)
            reason = _run_whisper(config, client, job, media_path, workdir, stop, fields)
            if reason is None:
                # The media is still there and the lease is still beating: this is the only
                # moment where diarization costs less than a second download.
                _diarize(client, diarizer, job, media_path, workdir, stop, fields)
        if reason is None:
            client.complete(run_id, transcription_id)
            log(logging.INFO, "job completed", **fields)
        elif reason == STOPPED_REASON:
            # The shutdown comes from us, not from the media: the attempt is abandoned, not
            # broken. Releasing it re-queues the request right away, where a failure would
            # condemn it and waiting for the lease to expire would cost the user two minutes.
            client.release(run_id, transcription_id)
            log(logging.INFO, "job released", **fields)
        else:
            client.fail(run_id, transcription_id, reason)
            log(logging.WARNING, "job failed", reason=reason, **fields)
    except ApiError as error:
        # The API is unreachable or refuses this run: the lease will expire and the API will
        # re-queue the transcription. Insisting here would only delay that recovery.
        log(logging.ERROR, "job abandoned", detail=str(error), status=error.status, **fields)
    except Exception as error:  # a broken job must never kill the loop
        log(logging.ERROR, "job crashed", detail=type(error).__name__, **fields)
        _fail_quietly(client, run_id, transcription_id, "worker error", fields)
    finally:
        heartbeat.stop()
        shutil.rmtree(workdir, ignore_errors=True)


def _diarize(client, diarizer, job, media_path, workdir, stop, fields):
    """Assigns the speaker turns. A failed pass never costs the transcript.

    Optional end to end: a worker without the capability says nothing about it, and any error
    — decoding, engine, API — boils down to a warning. The job concludes normally, transcript
    included; the user loses the speakers, not their transcription.

    An empty list is published like any other: on a replay it erases the assignment from a
    previous attempt, which the API recomputes from whatever we send it.
    """
    if diarizer is None or stop.is_set():
        return
    try:
        turns = diarizer.run(media_path, workdir)
        client.post_speakers(job["runId"], job["transcriptionId"], turns)
    except Exception as error:
        # The type is enough: a third-party library's message may carry a media path, which
        # has no place in the log.
        log(logging.WARNING, "diarization failed", detail=type(error).__name__, **fields)
        return
    log(
        logging.INFO,
        "speakers posted",
        turnCount=len(turns),
        speakerCount=len({turn["speaker"] for turn in turns}),
        **fields,
    )


def _reject_unsupported(job):
    """Trust boundary: model and language end up as process arguments."""
    if job.get("model") not in WHISPER_MODELS:
        return "unsupported model"
    if not LANGUAGE_PATTERN.match(str(job.get("language", ""))):
        return "unsupported language"
    return None


def _fail_quietly(client, run_id, transcription_id, reason, fields):
    try:
        client.fail(run_id, transcription_id, reason)
    except ApiError as error:
        log(logging.ERROR, "failure report lost", detail=str(error), **fields)


class Heartbeat:
    """Renews the lease in a thread, and stops cleanly on demand.

    The scheduler is injectable, like `SegmentBatcher`'s clock: any object answering
    `wait(timeout) -> bool` (true when the shutdown is requested) and `set()` will do. In
    production it is a `threading.Event`; a test swaps in a fake clock to exercise the
    heartbeats without sleeping.
    """

    def __init__(self, client, run_id, transcription_id, interval, fields, scheduler=None):
        self._client = client
        self._run_id = run_id
        self._transcription_id = transcription_id
        self._interval = interval
        self._fields = fields
        self._stop = scheduler if scheduler is not None else threading.Event()
        self._thread = None

    def start(self):
        self._thread = threading.Thread(target=self._loop, name="wisper-heartbeat", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=TERMINATE_GRACE_SECONDS)
            self._thread = None

    def _loop(self):
        while not self._stop.wait(self._interval):
            try:
                self._client.heartbeat(self._run_id, self._transcription_id)
            except ApiError as error:
                log(logging.WARNING, "heartbeat failed", status=error.status, **self._fields)
                if not error.retryable:
                    return  # run stale on the API side: this lease can no longer be renewed


def _heartbeat_interval(job):
    """A third of the remaining lease: two heartbeats can be lost without losing the job."""
    expires_at = _parse_iso8601(job.get("leaseExpiresAt"))
    if expires_at is None:
        return FALLBACK_HEARTBEAT_SECONDS
    remaining = (expires_at - datetime.now(timezone.utc)).total_seconds()
    return max(1.0, min(remaining / 3.0, FALLBACK_HEARTBEAT_SECONDS))


def _parse_iso8601(value):
    if not isinstance(value, str) or not value:
        return None
    try:
        # `datetime.fromisoformat` does not accept the "Z" suffix before Python 3.11.
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _run_whisper(config, client, job, media_path, workdir, stop, fields):
    """Runs whisper and publishes its segments. Returns `None` on success, a short reason otherwise."""
    command = [
        config.whisper_bin,
        media_path,
        "--model",
        job["model"],
        "--language",
        job["language"],
        "--output_format",
        "json",
        "--output_dir",
        workdir,
        "--verbose",
        "True",
        # Explicit device: whisper would infer it, but we want to see it in the log and to be
        # able to force CPU on a machine whose card is too tight.
        "--device",
        config.resolved_device,
    ]
    if config.resolved_device == "cuda":
        # On GPU, fp16 halves the card memory — that is what fits `medium` into 4 GiB of
        # VRAM. On CPU, fp16 is not supported: saying so avoids the warning and the pointless
        # conversion.
        command += ["--fp16", "True"]
    else:
        command += ["--fp16", "False", "--threads", str(config.resolved_threads)]
    if config.model_dir:
        command += ["--model_dir", config.model_dir]
    # Without PYTHONUNBUFFERED, stdout is block-buffered and no streaming happens.
    environment = dict(os.environ, PYTHONUNBUFFERED="1")
    # Argument list, never a shell: neither the model nor the language can escape.
    # stderr is captured AND re-emitted: the container stream keeps the full trace, and the tail
    # of that trace serves to explain a failure with something other than "code 1".
    process = subprocess.Popen(
        command,
        cwd=workdir,
        env=environment,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        errors="replace",
        bufsize=1,
    )
    log(logging.INFO, "whisper started", **fields)
    lines = queue.Queue()
    reader = threading.Thread(target=_pump, args=(process.stdout, lines), name="wisper-stdout", daemon=True)
    reader.start()
    diagnostics = collections.deque(maxlen=STDERR_TAIL_LINES)
    watcher = threading.Thread(
        target=_pump_stderr, args=(process.stderr, diagnostics), name="wisper-stderr", daemon=True
    )
    watcher.start()
    try:
        interrupted = _stream_segments(lines, client, job, stop, fields)
        if interrupted is not None:
            return interrupted
        # stdout is closed: the process exit is imminent.
        code = process.wait(timeout=TERMINATE_GRACE_SECONDS)
        if code == 0:
            return None
        watcher.join(timeout=TERMINATE_GRACE_SECONDS)
        return explain_failure(code, diagnostics)
    except subprocess.TimeoutExpired:
        return "whisper did not exit"
    finally:
        _terminate(process)
        reader.join(timeout=TERMINATE_GRACE_SECONDS)
        process.stdout.close()
        process.stderr.close()


def _pump_stderr(stderr, tail):
    """Re-emits whisper's diagnostics and keeps their tail to explain a failure."""
    try:
        for line in stderr:
            tail.append(line.rstrip("\n"))
            sys.stderr.write(line)
    except (ValueError, OSError):
        pass


# Signatures recognised in the stderr tail. A "code 1" tells the user nothing; these reasons
# say what to change. Order matters: the first match wins.
FAILURE_SIGNATURES = (
    ("out of memory", "model too large for this worker"),
    ("no kernel image is available", "model unsupported by this worker's gpu"),
    ("cuda", "gpu unavailable on this worker"),
    ("ffmpeg", "media could not be decoded"),
    ("no such file or directory", "media could not be read"),
)


def explain_failure(code, diagnostics):
    """Turns the stderr tail into a short reason, or falls back to the raw exit code."""
    haystack = " ".join(diagnostics).lower()
    for signature, reason in FAILURE_SIGNATURES:
        if signature in haystack:
            return reason
    return "whisper exited with code {}".format(code)


def _pump(stdout, lines):
    """Pours stdout into a queue: the main loop keeps control over timing."""
    try:
        for line in stdout:
            lines.put(line)
    except (ValueError, OSError):
        pass  # pipe closed under the thread: the sentinel is enough
    finally:
        lines.put(None)


def _stream_segments(lines, client, job, stop, fields):
    """Consumes the lines and publishes the batches. Returns `None` at the normal end of stream."""
    batcher = SegmentBatcher()
    sequence = 0
    deadline = time.monotonic() + WHISPER_TIMEOUT_SECONDS
    while True:
        if stop.is_set():
            return STOPPED_REASON
        if time.monotonic() >= deadline:
            return "transcription timed out"
        due_in = batcher.seconds_until_due()
        end_of_stream = False
        try:
            line = lines.get(timeout=LOOP_TICK_SECONDS if due_in is None else min(LOOP_TICK_SECONDS, due_in))
        except queue.Empty:
            batch = batcher.due()
        else:
            end_of_stream = line is None
            if end_of_stream:
                batch = batcher.flush()
            else:
                segment = parse_segment_line(line)
                batch = batcher.add(segment) if segment is not None else None
        if batch:
            sequence += 1
            _post(client, job, sequence, batch, fields)
        if end_of_stream:
            return None


def _post(client, job, sequence, batch, fields):
    client.post_segments(job["runId"], job["transcriptionId"], sequence, batch)
    log(logging.INFO, "segments posted", batchSequence=sequence, segmentCount=len(batch), **fields)


def _terminate(process):
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=TERMINATE_GRACE_SECONDS)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=TERMINATE_GRACE_SECONDS)


def main():
    configure_logging()
    try:
        config = WorkerConfig.from_environment(os.environ)
    except ConfigurationError as error:
        log(logging.ERROR, "configuration rejected", detail=str(error))
        return 2
    config = resolve_runtime(config)
    stop = threading.Event()
    for received in (signal.SIGTERM, signal.SIGINT):
        signal.signal(received, lambda *_: stop.set())
    client = ApiClient(config.api_url, config.worker_token)
    # Once and for all: the capability does not change from one job to the next, and a worker
    # that does not diarize must pay nothing for that pass.
    run_loop(config, client, stop, diarization.load(os.environ))
    return 0


if __name__ == "__main__":
    sys.exit(main())
