"""Client HTTP du worker vers l'API WisperPlatform.

Bibliothèque standard uniquement (`urllib`). Trois garanties :

- chaque appel porte un timeout explicite ;
- les rejeux sont bornés (`MAX_ATTEMPTS`), en backoff exponentiel plafonné avec jitter ;
- seules les causes transitoires sont rejouées (erreur réseau, 429, 5xx). Une 4xx métier
  remonte immédiatement : la rejouer ne changerait rien et ferait perdre du temps au bail.

Le jeton porteur ne quitte jamais l'en-tête `Authorization`, et le jeton média ne quitte
jamais l'URL : aucun message d'erreur ne contient d'URL, donc aucun log ne peut les fuiter.
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
# Timeout d'une opération socket pendant le téléchargement, pas de la durée totale :
# un média de plusieurs Gio est légitimement long, un socket muet 5 minutes ne l'est pas.
DOWNLOAD_TIMEOUT_SECONDS = 300.0
MAX_ATTEMPTS = 3
BACKOFF_BASE_SECONDS = 0.5
BACKOFF_MAX_SECONDS = 8.0


class ApiError(Exception):
    """Échec d'un appel à l'API. `retryable` distingue le transitoire du définitif."""

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
        """Réclame un job. Rend la vue du job, ou `None` quand la file est vide (204)."""
        return self._send(
            "claim",
            "POST",
            "/api/worker/jobs/claim",
            {"workerId": worker_id, "models": list(models)},
        )

    def download_media(self, token, destination):
        """Écrit le média du run dans `destination` (jamais son nom d'origine)."""
        path = "/api/worker/media/" + urllib.parse.quote(token, safe="")
        request = self._build_request("GET", path, None)

        def perform():
            with self._opener(request, timeout=self._download_timeout) as response:
                with open(destination, "wb") as sink:
                    shutil.copyfileobj(response, sink)

        self._with_retries("media download", perform)

    def post_segments(self, run_id, transcription_id, batch_sequence, segments):
        """Publie un lot. `batch_sequence` rend l'opération idempotente au rejeu."""
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
        """Publie les tours de parole du run. Rejouable : l'API recalcule l'attribution."""
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
        """Rend la tentative sans la déclarer en échec : la demande repart en file aussitôt."""
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
                # Corps hors contrat (page d'erreur d'un proxy, par exemple) : rejouer
                # n'y changerait rien, et le contenu n'a pas sa place dans un message.
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
                    # 4xx métier : erreur définitive, jamais rejouée.
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
                # `URLError` et les timeouts socket dérivent tous d'`OSError`.
                # Seule la cause est reprise : jamais l'URL, qui porte le jeton média.
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
    """Backoff exponentiel plafonné, avec jitter complet pour désynchroniser les workers."""
    ceiling = min(BACKOFF_BASE_SECONDS * (2 ** (attempt - 1)), BACKOFF_MAX_SECONDS)
    return random.uniform(0.0, ceiling)
