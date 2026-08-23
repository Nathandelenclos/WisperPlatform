"""The worker's diarization pass: who speaks when.

Optional by construction. A worker whose image carries neither `sherpa-onnx` nor the ONNX
models declares nothing and transcribes exactly as before: `load` returns `None` and the pass
simply does not happen. No exception ever escapes from here at startup.

The media is decoded to 16 kHz mono PCM by `ffmpeg` — already in the image for `whisper` —
into a temporary file inside the job working directory, read back by the standard `wave`
module, then erased in every case. Nothing of the media survives the pass.

`sherpa_onnx` and `numpy` are imported at the last moment: their absence is a missing
capability, not an import error while loading the worker.
"""

from __future__ import annotations

import dataclasses
import importlib.util
import logging
import os
import subprocess
import tempfile
import wave

# Sample rate expected by both models. Neither accepts anything else: it is a constant of
# the model pair, not a setting.
SAMPLE_RATE = 16000

DEFAULT_SEGMENTATION_MODEL = "/opt/diarization/segmentation.onnx"
DEFAULT_EMBEDDING_MODEL = "/opt/diarization/embedding.onnx"
# Two threads are enough: measured at 0.060x real time on this machine. Beyond that, the pass
# fights whisper for cores, and whisper dominates the cost of the job by far.
DEFAULT_THREADS = 2
DEFAULT_CLUSTER_THRESHOLD = 0.5
# -1: the clustering discovers the speaker count on its own.
AUTOMATIC_SPEAKERS = -1

# Bounds of the pyannote segmentation, in seconds: below them, a turn is noise and a silence
# is not one. These are the model's reference values.
MIN_DURATION_ON = 0.3
MIN_DURATION_OFF = 0.5

FFMPEG_BIN = "ffmpeg"
# Decoding is not transcribing: past this, ffmpeg is stuck, not slow.
DECODE_TIMEOUT_SECONDS = 30 * 60
# Ceiling on the decoded duration. The pass materialises the whole signal in memory — about
# 10 bytes per sample at peak, i.e. ~576 MiB per hour of audio. The kernel kills a container
# that exceeds its memory bound with SIGKILL, which nothing catches in Python: neither the
# guard of the pass, nor the one of the job. An already produced transcript would be lost,
# although it was completing before this pass. The ceiling is therefore set on the SMALLEST
# worker of the fleet (3 GiB for the GPU worker), not on the largest, and going over becomes a
# recoverable failure: diarization is skipped, the transcription concludes.
MAX_DECODED_SECONDS = 4 * 60 * 60

REQUIRED_MODULES = ("sherpa_onnx", "numpy")

# Child of the worker logger: same JSON formatter, same stream, no duplicate configuration.
LOGGER = logging.getLogger("wisper.worker.diarization")


def log(level, message, **fields):
    LOGGER.log(level, message, extra={"fields": fields})


class Unavailable(Exception):
    """Why this worker cannot diarize. Never an outage: a capability."""


class DiarizationError(Exception):
    """Failure of the pass on a job. The transcript itself stays good."""


@dataclasses.dataclass(frozen=True)
class DiarizationConfig:
    segmentation_model: str
    embedding_model: str
    threads: int
    max_speakers: int
    cluster_threshold: float

    @staticmethod
    def from_environment(environ):
        return DiarizationConfig(
            segmentation_model=_path(
                environ, "WISPER_DIARIZATION_SEGMENTATION_MODEL", DEFAULT_SEGMENTATION_MODEL
            ),
            embedding_model=_path(
                environ, "WISPER_DIARIZATION_EMBEDDING_MODEL", DEFAULT_EMBEDDING_MODEL
            ),
            threads=_positive_int(environ, "WISPER_DIARIZATION_THREADS", DEFAULT_THREADS),
            max_speakers=_speaker_count(
                environ, "WISPER_DIARIZATION_MAX_SPEAKERS", AUTOMATIC_SPEAKERS
            ),
            cluster_threshold=_positive_float(
                environ, "WISPER_DIARIZATION_CLUSTER_THRESHOLD", DEFAULT_CLUSTER_THRESHOLD
            ),
        )


def _raw(environ, name):
    value = (environ.get(name) or "").strip()
    return value or None


def _path(environ, name, default):
    if name in environ and _raw(environ, name) is None:
        # Variable set but empty: a configuration mistake, not a choice of the default.
        raise Unavailable("{} is empty".format(name))
    return _raw(environ, name) or default


def _positive_int(environ, name, default):
    raw = _raw(environ, name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise Unavailable("{} must be an integer".format(name)) from None
    if value < 1:
        raise Unavailable("{} must be greater than or equal to 1".format(name))
    return value


def _speaker_count(environ, name, default):
    """A speaker count: an integer >= 1, or the automatic sentinel.

    `AUTOMATIC_SPEAKERS` is the value this module designates as "let the clustering decide":
    refusing it would switch off all diarization for the operator who writes it precisely to
    make that choice explicit, and one info line would be the only clue.
    """
    raw = _raw(environ, name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise Unavailable("{} must be an integer".format(name)) from None
    if value != AUTOMATIC_SPEAKERS and value < 1:
        raise Unavailable(
            "{} must be {} (automatic) or an integer greater than or equal to 1".format(
                name, AUTOMATIC_SPEAKERS
            )
        )
    return value


def _positive_float(environ, name, default):
    raw = _raw(environ, name)
    if raw is None:
        return default
    try:
        value = float(raw)
    except ValueError:
        raise Unavailable("{} must be a number".format(name)) from None
    if value <= 0:
        raise Unavailable("{} must be strictly positive".format(name))
    return value


def load(environ, exists=os.path.exists, find_module=importlib.util.find_spec):
    """Returns a ready-to-use `Diarizer`, or `None` when the capability is missing.

    Called once at startup: probing the modules and the files on every job would never say
    anything new, and a worker that does not diarize must cost nothing.
    """
    try:
        config = DiarizationConfig.from_environment(environ)
        _require_modules(find_module)
        _require_models(config, exists)
    except Unavailable as absent:
        log(logging.INFO, "diarization disabled", reason=str(absent))
        return None
    log(
        logging.INFO,
        "diarization enabled",
        threads=config.threads,
        maxSpeakers=config.max_speakers,
        clusterThreshold=config.cluster_threshold,
    )
    return Diarizer(config)


def _require_modules(find_module):
    for name in REQUIRED_MODULES:
        try:
            found = find_module(name)
        except (ImportError, ValueError):
            found = None
        if found is None:
            raise Unavailable("module {} is not installed".format(name))


def _require_models(config, exists):
    for path in (config.segmentation_model, config.embedding_model):
        if not exists(path):
            raise Unavailable("model {} is missing".format(path))


class Diarizer:
    """The sherpa-onnx engine and its decoding, set up on the first pass then reused.

    Loading 45 MiB of ONNX weights costs several seconds: doing it on every job would be a
    waste. The worker handles one job at a time, so the object never sees two concurrent calls.
    """

    def __init__(self, config, engine_factory=None, decode=None, to_samples=None):
        self._config = config
        self._engine_factory = engine_factory if engine_factory is not None else build_engine
        self._decode = decode if decode is not None else decode_pcm
        # Last seam: the conversion to floats is the only thing here that requires numpy.
        # Injecting it keeps the decoding, the cleanup and this loop testable on a bare
        # Python — which is what CI does, installing nothing for the worker.
        self._to_samples = to_samples if to_samples is not None else _as_float32
        self._engine = None

    def run(self, media_path, workdir):
        """Returns the media's speaker turns, in milliseconds, sorted by start."""
        frames, sample_rate = self._decode(media_path, workdir)
        engine = self._engine
        if engine is None:
            engine = self._engine = self._engine_factory(self._config)
        if engine.sample_rate != sample_rate:
            raise DiarizationError(
                "the engine expects {} Hz, the media was decoded at {} Hz".format(
                    engine.sample_rate, sample_rate
                )
            )
        return to_turns(engine.process(self._to_samples(frames)).sort_by_start_time())


def _as_float32(frames):
    """Converts 16-bit PCM frames into normalised floats, which is what sherpa expects.

    numpy lives here and nowhere else: it is a dependency of sherpa-onnx, so it is present
    everywhere the engine runs — and absent from the tests, which have no engine.

    `frombuffer` does not copy, `astype` produces the only copy, and the normalisation happens
    IN PLACE: writing `astype(...) / 32768.0` would allocate a second float array while the
    first one is still alive, i.e. a peak of 10 bytes per sample instead of 6.
    """
    import numpy

    samples = numpy.frombuffer(frames, dtype="<i2").astype(numpy.float32)
    samples /= 32768.0
    return samples


def build_engine(config):
    import sherpa_onnx

    settings = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(
                model=config.segmentation_model
            ),
            num_threads=config.threads,
        ),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(
            model=config.embedding_model, num_threads=config.threads
        ),
        clustering=sherpa_onnx.FastClusteringConfig(
            num_clusters=config.max_speakers, threshold=config.cluster_threshold
        ),
        min_duration_on=MIN_DURATION_ON,
        min_duration_off=MIN_DURATION_OFF,
    )
    if not settings.validate():
        raise DiarizationError("sherpa-onnx configuration refused")
    return sherpa_onnx.OfflineSpeakerDiarization(settings)


def to_turns(segments):
    """Translates the engine output into turns of the HTTP contract.

    Whole milliseconds, start clamped to zero, empty turns discarded: the contract requires
    `startMs >= 0` and `endMs > startMs`, and a model overshooting by a few hundredths must not
    turn a successful pass into a 422.
    """
    turns = []
    for segment in segments:
        start = max(0, int(round(segment.start * 1000)))
        end = int(round(segment.end * 1000))
        if end <= start:
            continue
        turns.append({"startMs": start, "endMs": end, "speaker": int(segment.speaker)})
    turns.sort(key=lambda turn: (turn["startMs"], turn["endMs"]))
    return turns


def decode_pcm(media_path, workdir, run=subprocess.run):
    """Decodes the media to 16 kHz mono PCM and returns `(16-bit frames, sample rate)`.

    The intermediate file lives in the job working directory — erased along with it — and is
    removed as soon as the read is done, success or failure: an uncompressed WAV weighs more
    than the original media.
    """
    handle, wav_path = tempfile.mkstemp(prefix="diarization-", suffix=".wav", dir=workdir)
    os.close(handle)
    try:
        # Argument list, never a shell. `-nostdin`: ffmpeg must not fight the worker for
        # standard input. `-y`: the file already exists, mkstemp created it.
        run(
            [
                FFMPEG_BIN,
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                media_path,
                "-vn",
                # Belt: ffmpeg stops at the ceiling, so the WAV cannot be longer than what
                # the worker's memory holds.
                "-t",
                str(MAX_DECODED_SECONDS),
                "-ac",
                "1",
                "-ar",
                str(SAMPLE_RATE),
                "-c:a",
                "pcm_s16le",
                "-f",
                "wav",
                wav_path,
            ],
            check=True,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=DECODE_TIMEOUT_SECONDS,
        )
        return read_wav(wav_path)
    finally:
        # `missing_ok` does not exist here: ffmpeg may have replaced the file, never erased
        # it. A cleanup failure must not mask the decoding failure.
        try:
            os.unlink(wav_path)
        except OSError:
            pass


def read_wav(path):
    """Returns `(signed 16-bit PCM frames, sample rate)`. No third-party dependency here.

    The conversion to floats belongs to `Diarizer.run`, as close to sherpa as possible: it is
    sherpa that requires numpy, and it alone. The decoding, the read and the cleanup therefore
    stay testable on a bare Python — which is what CI does.
    """
    with wave.open(path, "rb") as source:
        if source.getsampwidth() != 2 or source.getnchannels() != 1:
            raise DiarizationError("decoding did not produce 16-bit mono PCM")
        sample_rate = source.getframerate()
        frame_count = source.getnframes()
        # Braces: ffmpeg may have ignored `-t`, or the file may not come from it at all.
        # The refusal happens BEFORE allocating, the only moment where it can still be a
        # recoverable failure rather than a SIGKILL from the kernel.
        if frame_count > MAX_DECODED_SECONDS * max(1, sample_rate):
            raise DiarizationError(
                "media too long to diarize: {} s decoded, ceiling {} s".format(
                    frame_count // max(1, sample_rate), MAX_DECODED_SECONDS
                )
            )
        frames = source.readframes(frame_count)
    return frames, sample_rate
