"""HTTP client from the worker to the WisperPlatform API.

Standard library only (`urllib`). Three guarantees:

- every call carries an explicit timeout;
- retries are bounded (`MAX_ATTEMPTS`), with capped exponential backoff and jitter;
- only transient causes are retried (network error, 429, 5xx). A business 4xx surfaces
  immediately: retrying it would change nothing and would waste lease time.

The bearer token never leaves the `Authorization` header, and the media token never leaves
the URL: no error message contains a URL, so no log can leak either of them.
"""

from __future__ import annotations

import json
import random
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request

REQUEST_TIMEOUT_SECONDS = 15.0
# Timeout of a single socket operation during the download, not of the total duration:
# a media file of several GiB is legitimately long, a socket silent for 5 minutes is not.
DOWNLOAD_TIMEOUT_SECONDS = 300.0
MAX_ATTEMPTS = 3
BACKOFF_BASE_SECONDS = 0.5
BACKOFF_MAX_SECONDS = 8.0


class ApiError(Exception):
    """Failure of an API call. `retryable` tells the transient apart from the definitive."""

    def __init__(self, message, status=None, retryable=False):
        super().__init__(message)
        self.status = status
        self.retryable = retryable


class ApiClient:
    def __init__(
        self,
        base_url,
        token,
        timeout=REQUEST_TIMEOUT_SECONDS,
        download_timeout=DOWNLOAD_TIMEOUT_SECONDS,
        opener=urllib.request.urlopen,
        sleeper=time.sleep,
    ):
        self._base_url = base_url.rstrip("/")
        self._token = token
        self._timeout = timeout
        self._download_timeout = download_timeout
        self._opener = opener
        self._sleeper = sleeper

    def claim(self, worker_id, models):
        """Claims a job. Returns the job view, or `None` when the queue is empty (204)."""
        return self._send(
            "claim",
            "POST",
            "/api/worker/jobs/claim",
            {"workerId": worker_id, "models": list(models)},
        )

    def download_media(self, token, destination):
        """Writes the run's media into `destination` (never under its original name)."""
        path = "/api/worker/media/" + urllib.parse.quote(token, safe="")
        request = self._build_request("GET", path, None)

        def perform():
            with self._opener(request, timeout=self._download_timeout) as response:
                with open(destination, "wb") as sink:
                    shutil.copyfileobj(response, sink)

        self._with_retries("media download", perform)

    def post_segments(self, run_id, transcription_id, batch_sequence, segments):
        """Publishes a batch. `batch_sequence` makes the operation idempotent on replay."""
        self._send(
            "segments",
            "POST",
            self._job_path(run_id, "segments"),
            {
                "transcriptionId": transcription_id,
                "batchSequence": batch_sequence,
                "segments": segments,
            },
        )

    def post_speakers(self, run_id, transcription_id, turns):
        """Publishes the run's speaker turns. Replayable: the API recomputes the assignment."""
        self._send(
            "speakers",
            "POST",
            self._job_path(run_id, "speakers"),
            {"transcriptionId": transcription_id, "turns": turns},
        )

    def heartbeat(self, run_id, transcription_id):
        return self._send(
            "heartbeat",
            "POST",
            self._job_path(run_id, "heartbeat"),
            {"transcriptionId": transcription_id},
        )

    def complete(self, run_id, transcription_id):
        self._send(
            "complete",
            "POST",
            self._job_path(run_id, "complete"),
            {"transcriptionId": transcription_id},
        )

    def fail(self, run_id, transcription_id, reason):
        self._send(
            "fail",
            "POST",
            self._job_path(run_id, "fail"),
            {"transcriptionId": transcription_id, "reason": reason},
        )

    def release(self, run_id, transcription_id):
        """Releases the attempt without failing it: the request goes back to the queue at once."""
        self._send(
            "release",
            "POST",
            self._job_path(run_id, "release"),
            {"transcriptionId": transcription_id},
        )

    @staticmethod
    def _job_path(run_id, action):
        return "/api/worker/jobs/" + urllib.parse.quote(str(run_id), safe="") + "/" + action

    def _send(self, operation, method, path, payload):
        request = self._build_request(method, path, payload)

        def perform():
            with self._opener(request, timeout=self._timeout) as response:
                body = response.read()
            if response.status == 204 or not body:
                return None
            try:
                return json.loads(body.decode("utf-8"))
            except (UnicodeDecodeError, ValueError):
                # Off-contract body (a proxy error page, for instance): retrying would change
                # nothing, and the content has no place in a message.
                raise ApiError("{} returned a malformed body".format(operation), status=response.status) from None

        return self._with_retries(operation, perform)

    def _build_request(self, method, path, payload):
        headers = {
            "Authorization": "Bearer " + self._token,
            "Accept": "application/json",
        }
        body = None
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        return urllib.request.Request(self._base_url + path, data=body, headers=headers, method=method)

    def _with_retries(self, operation, perform):
        failure = None
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                return perform()
            except urllib.error.HTTPError as error:
                if not _is_transient_status(error.code):
                    # Business 4xx: definitive error, never retried.
                    raise ApiError(
                        "{} rejected with HTTP {}".format(operation, error.code),
                        status=error.code,
                        retryable=False,
                    ) from None
                failure = ApiError(
                    "{} failed with HTTP {}".format(operation, error.code),
                    status=error.code,
                    retryable=True,
                )
            except OSError as error:
                # `URLError` and socket timeouts all derive from `OSError`.
                # Only the cause is carried over: never the URL, which holds the media token.
                failure = ApiError(
                    "{} failed: {}".format(operation, _cause_of(error)),
                    retryable=True,
                )
            if attempt < MAX_ATTEMPTS:
                self._sleeper(_backoff_delay(attempt))
        raise failure


def _is_transient_status(status):
    return status == 429 or status >= 500


def _cause_of(error):
    reason = getattr(error, "reason", None)
    if reason is None:
        return type(error).__name__
    return "{}: {}".format(type(error).__name__, reason)


def _backoff_delay(attempt):
    """Capped exponential backoff, with full jitter to desynchronise the workers."""
    ceiling = min(BACKOFF_BASE_SECONDS * (2 ** (attempt - 1)), BACKOFF_MAX_SECONDS)
    return random.uniform(0.0, ceiling)
