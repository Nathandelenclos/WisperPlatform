#!/usr/bin/env python3
"""Worker de transcription WisperPlatform.

Boucle : réclamer un job → télécharger le média → lancer le binaire `whisper` → publier les
segments au fil de l'eau → conclure (`complete` / `fail`) → effacer le répertoire temporaire.

Bibliothèque standard uniquement. `whisper` est lancé comme processus, en liste d'arguments,
jamais via un shell, jamais importé.

Le worker n'apprend rien de l'utilisateur : il reçoit un jeton média à courte durée de vie,
écrit le média sous un nom neutre, et ne journalise ni jeton, ni nom de fichier, ni texte
transcrit — seulement des identifiants techniques et des compteurs.
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

# Modèles du contrat (`WHISPER_MODELS` côté domaine).
WHISPER_MODELS = ("tiny", "base", "small", "medium", "large", "turbo")
LANGUAGE_PATTERN = re.compile(r"^[A-Za-z]{2,32}$")

# Borne dure d'un job : au-delà, le sous-processus est arrêté et le job déclaré en échec.
WHISPER_TIMEOUT_SECONDS = 6 * 60 * 60
# Délai laissé à `whisper` pour sortir après `terminate`, avant `kill`.
TERMINATE_GRACE_SECONDS = 10.0
# Période de réveil de la boucle de lecture : borne la réactivité à un arrêt demandé.
LOOP_TICK_SECONDS = 0.5
# Bail inexploitable (absent ou illisible) : repli prudent sur un battement fréquent.
FALLBACK_HEARTBEAT_SECONDS = 20.0
# Disjoncteur de la boucle de réclamation : au-delà de ce nombre d'échecs consécutifs de
# `claim`, le circuit s'ouvre et l'intervalle de sondage croît jusqu'à son plafond. Un
# `claim` abouti — job servi ou file vide — referme le circuit.
CLAIM_FAILURE_THRESHOLD = 5
CLAIM_BACKOFF_MAX_SECONDS = 60.0
# Nom neutre du média sur le disque : le nom d'origine ne quitte jamais l'API.
MEDIA_FILENAME = "media"

# Nombre de lignes de stderr conservées pour expliquer un échec : assez pour une trace Python,
# trop peu pour retenir un transcript entier.
STDERR_TAIL_LINES = 40

# Raison interne : l'arrêt vient du worker lui-même, jamais du média ni de l'API.
STOPPED_REASON = "worker stopped"

LOGGER = logging.getLogger("wisper.worker")


class ConfigurationError(Exception):
    """Configuration d'environnement absente ou invalide."""


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
    # Résolus une fois au démarrage par `resolve_runtime`, jamais à chaque job : sonder la
    # carte coûte le démarrage d'un interpréteur.
    resolved_device: str = "cpu"
    resolved_threads: int = 1

    @staticmethod
    def from_environment(environ):
        api_url = (environ.get("WISPER_API_URL") or "").strip()
        if not api_url:
            raise ConfigurationError("WISPER_API_URL est requis")
        worker_token = environ.get("WISPER_WORKER_TOKEN") or ""
        if not worker_token.strip():
            raise ConfigurationError("WISPER_WORKER_TOKEN est requis")
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
            "WISPER_WORKER_MODELS n'accepte que : " + ", ".join(WHISPER_MODELS)
        )
    return models


DEVICES = ("auto", "cpu", "cuda")


def _parse_device(raw):
    device = (raw or "").strip().lower() or "auto"
    if device not in DEVICES:
        raise ConfigurationError("WISPER_DEVICE n'accepte que : " + ", ".join(DEVICES))
    return device


def _parse_threads(raw):
    """0 = déduire du quota CPU du conteneur."""
    if raw is None or not raw.strip():
        return 0
    try:
        threads = int(raw)
    except ValueError:
        raise ConfigurationError("WISPER_THREADS doit être un entier") from None
    if threads < 0:
        raise ConfigurationError("WISPER_THREADS doit être positif ou nul")
    return threads


def cpu_quota(read_text=None):
    """
    Nombre de cœurs réellement utilisables, lu dans le cgroup plutôt que sur la machine.
    Sans cette borne, torch ouvre autant de threads que l'hôte a de cœurs alors que le
    conteneur n'en a que deux : les threads se disputent le quota et l'inférence RALENTIT.
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
    `auto` interroge une fois le torch de whisper : c'est lui qui sait si une carte est
    visible dans le conteneur. Une carte absente n'est pas une erreur, on reste en CPU.
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
    """Fixe une fois pour toutes le device et le nombre de threads de ce worker."""
    device = resolve_device(config, probe)
    threads = config.threads or (quota or cpu_quota)()
    return dataclasses.replace(config, resolved_device=device, resolved_threads=max(1, threads))


def _parse_poll_interval(raw):
    if raw is None or not raw.strip():
        return 3.0
    try:
        interval = float(raw)
    except ValueError:
        raise ConfigurationError("POLL_INTERVAL_SECONDS doit être un nombre de secondes") from None
    if interval <= 0:
        raise ConfigurationError("POLL_INTERVAL_SECONDS doit être strictement positif")
    return interval


class JsonFormatter(logging.Formatter):
    """Une ligne JSON par événement. Aucun secret, aucune donnée personnelle."""

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
    """Réclame et traite des jobs jusqu'à ce que `stop` soit armé.

    Le disjoncteur vit ici : `failures` compte les `claim` consécutivement perdus et
    espace les sondages une fois le seuil franchi, pour ne pas marteler une API qui
    tente de se relever. L'attente passe toujours par `stop.wait`, jamais par `sleep` :
    un arrêt demandé la tranche net, circuit ouvert ou non.
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
            # Une 4xx définitive — jeton refusé, worker inconnu — n'est pas une panne
            # transitoire : elle ne guérira pas seule, l'exploitant doit la distinguer.
            # `str(error)` ne porte que l'opération et le statut, jamais l'URL ni le jeton.
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
            # File vide : l'API a répondu, le circuit se referme.
            failures = 0
            stop.wait(config.poll_interval_seconds)
            continue
        if not _is_usable_job(job):
            # Réponse hors contrat : on ne peut ni la traiter, ni la déclarer en échec.
            # Une API qui ne respecte plus le contrat est en panne : elle ouvre le circuit.
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
    """Intervalle avant le prochain `claim`, selon le nombre d'échecs consécutifs.

    Circuit fermé : l'intervalle nominal. Ouvert : il double à chaque échec supplémentaire
    jusqu'au plafond, et le jitter répartit entre le nominal et ce plafond des workers
    redémarrés ensemble, qui sinon retomberaient tous sur l'API à la même seconde.
    """
    if failures < CLAIM_FAILURE_THRESHOLD:
        return interval
    # L'exposant est borné : une API absente une journée entière ne doit pas faire déborder
    # le flottant, et le plafond est de toute façon atteint en quelques échecs.
    doublings = min(failures - CLAIM_FAILURE_THRESHOLD + 1, 32)
    ceiling = max(interval, min(interval * 2**doublings, CLAIM_BACKOFF_MAX_SECONDS))
    return interval + (ceiling - interval) * jitter()


def _is_usable_job(job):
    """Champs sans lesquels aucune action n'est possible, pas même signaler l'échec."""
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
        # Le bail court dès la réclamation : le battement couvre aussi le téléchargement.
        heartbeat.start()
        reason = _reject_unsupported(job)
        if reason is None:
            media_path = os.path.join(workdir, MEDIA_FILENAME)
            client.download_media(job["mediaToken"], media_path)
            reason = _run_whisper(config, client, job, media_path, workdir, stop, fields)
            if reason is None:
                # Le média est encore là et le bail bat toujours : c'est le seul moment
                # où la diarisation coûte moins qu'un second téléchargement.
                _diarize(client, diarizer, job, media_path, workdir, stop, fields)
        if reason is None:
            client.complete(run_id, transcription_id)
            log(logging.INFO, "job completed", **fields)
        elif reason == STOPPED_REASON:
            # L'arrêt vient de nous, pas du média : la tentative est abandonnée, pas cassée.
            # La rendre remet la demande en file tout de suite, là où un échec la condamnerait
            # et où attendre l'extinction du bail coûterait deux minutes à l'utilisateur.
            client.release(run_id, transcription_id)
            log(logging.INFO, "job released", **fields)
        else:
            client.fail(run_id, transcription_id, reason)
            log(logging.WARNING, "job failed", reason=reason, **fields)
    except ApiError as error:
        # L'API est injoignable ou refuse ce run : le bail expirera et la transcription
        # sera remise en file côté API. Insister ici ne ferait que retarder cette reprise.
        log(logging.ERROR, "job abandoned", detail=str(error), status=error.status, **fields)
    except Exception as error:  # un job cassé ne doit jamais tuer la boucle
        log(logging.ERROR, "job crashed", detail=type(error).__name__, **fields)
        _fail_quietly(client, run_id, transcription_id, "worker error", fields)
    finally:
        heartbeat.stop()
        shutil.rmtree(workdir, ignore_errors=True)


def _diarize(client, diarizer, job, media_path, workdir, stop, fields):
    """Attribue les tours de parole. Une passe ratée ne coûte jamais le transcript.

    Facultative de bout en bout : un worker sans la capacité n'en dit rien, et toute erreur
    — décodage, moteur, API — se résume à un avertissement. Le job se conclut normalement,
    transcript compris ; l'utilisateur perd les locuteurs, pas sa transcription.

    Une liste vide est publiée comme les autres : au rejeu, elle efface l'attribution d'une
    tentative précédente, que l'API recalcule à partir de ce qu'on lui envoie.
    """
    if diarizer is None or stop.is_set():
        return
    try:
        turns = diarizer.run(media_path, workdir)
        client.post_speakers(job["runId"], job["transcriptionId"], turns)
    except Exception as error:
        # Le type suffit : le message d'une bibliothèque tierce peut porter un chemin de
        # média, qui n'a pas sa place dans le journal.
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
    """Frontière de confiance : model et language finissent en arguments de processus."""
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
    """Renouvelle le bail dans un thread, et s'arrête proprement sur demande.

    L'ordonnanceur est injectable, comme l'horloge de `SegmentBatcher` : tout objet qui
    répond à `wait(timeout) -> bool` (vrai quand l'arrêt est demandé) et à `set()` fait
    l'affaire. En production c'est un `threading.Event` ; un test le remplace par une
    fausse horloge pour éprouver les battements sans dormir.
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
                    return  # run périmé côté API : ce bail n'est plus renouvelable


def _heartbeat_interval(job):
    """Un tiers du bail restant : deux battements peuvent être perdus sans perdre le job."""
    expires_at = _parse_iso8601(job.get("leaseExpiresAt"))
    if expires_at is None:
        return FALLBACK_HEARTBEAT_SECONDS
    remaining = (expires_at - datetime.now(timezone.utc)).total_seconds()
    return max(1.0, min(remaining / 3.0, FALLBACK_HEARTBEAT_SECONDS))


def _parse_iso8601(value):
    if not isinstance(value, str) or not value:
        return None
    try:
        # `datetime.fromisoformat` n'accepte pas le suffixe « Z » avant Python 3.11.
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _run_whisper(config, client, job, media_path, workdir, stop, fields):
    """Lance whisper et publie ses segments. Rend `None` en succès, une raison courte sinon."""
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
        # Device explicite : whisper le déduirait, mais on veut le voir dans le journal et
        # pouvoir forcer le CPU sur une machine dont la carte est trop juste.
        "--device",
        config.resolved_device,
    ]
    if config.resolved_device == "cuda":
        # Sur GPU, fp16 divise par deux la mémoire de la carte — c'est ce qui fait tenir
        # `medium` dans 4 Gio de VRAM. Sur CPU, fp16 n'est pas supporté : le dire évite
        # l'avertissement et la conversion inutile.
        command += ["--fp16", "True"]
    else:
        command += ["--fp16", "False", "--threads", str(config.resolved_threads)]
    if config.model_dir:
        command += ["--model_dir", config.model_dir]
    # Sans PYTHONUNBUFFERED, stdout est bufferisé par blocs et le streaming n'a pas lieu.
    environment = dict(os.environ, PYTHONUNBUFFERED="1")
    # Liste d'arguments, jamais de shell : ni le modèle ni la langue ne peuvent s'échapper.
    # stderr est capturé ET réémis : le flux du conteneur garde la trace complète, et la fin de
    # cette trace sert à expliquer un échec autrement que par « code 1 ».
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
        # stdout est fermé : la sortie du processus est imminente.
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
    """Réémet les diagnostics de whisper et garde leur fin pour expliquer un échec."""
    try:
        for line in stderr:
            tail.append(line.rstrip("\n"))
            sys.stderr.write(line)
    except (ValueError, OSError):
        pass


# Signatures reconnues dans la fin de stderr. Un « code 1 » ne dit rien à l'utilisateur ; ces
# raisons-là disent quoi changer. L'ordre compte : la première qui correspond gagne.
FAILURE_SIGNATURES = (
    ("out of memory", "model too large for this worker"),
    ("no kernel image is available", "model unsupported by this worker's gpu"),
    ("cuda", "gpu unavailable on this worker"),
    ("ffmpeg", "media could not be decoded"),
    ("no such file or directory", "media could not be read"),
)


def explain_failure(code, diagnostics):
    """Traduit la fin de stderr en une raison courte, ou rend le code brut à défaut."""
    haystack = " ".join(diagnostics).lower()
    for signature, reason in FAILURE_SIGNATURES:
        if signature in haystack:
            return reason
    return "whisper exited with code {}".format(code)


def _pump(stdout, lines):
    """Déverse stdout dans une file : la boucle principale garde la main sur le temps."""
    try:
        for line in stdout:
            lines.put(line)
    except (ValueError, OSError):
        pass  # tube fermé sous le thread : la sentinelle suffit
    finally:
        lines.put(None)


def _stream_segments(lines, client, job, stop, fields):
    """Consomme les lignes et publie les lots. Rend `None` à la fin normale du flux."""
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
    # Une fois pour toutes : la capacité ne change pas d'un job à l'autre, et un worker qui
    # ne diarise pas ne doit rien payer pour cette passe.
    run_loop(config, client, stop, diarization.load(os.environ))
    return 0


if __name__ == "__main__":
    sys.exit(main())
