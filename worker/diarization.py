"""Passe de diarisation du worker : qui parle quand.

Facultative par construction. Un worker dont l'image ne porte ni `sherpa-onnx` ni les
modèles ONNX ne déclare rien et transcrit exactement comme avant : `load` rend `None` et
la passe n'a simplement pas lieu. Aucune exception ne remonte d'ici au démarrage.

Le média est décodé en PCM 16 kHz mono par `ffmpeg` — déjà présent dans l'image pour
`whisper` — vers un fichier temporaire du répertoire de travail du job, relu par le module
standard `wave`, puis effacé dans tous les cas. Rien du média ne survit à la passe.

`sherpa_onnx` et `numpy` sont importés au dernier moment : leur absence est une capacité
manquante, pas une erreur d'import au chargement du worker.
"""

from __future__ import annotations

import dataclasses
import importlib.util
import logging
import os
import subprocess
import tempfile
import wave

# Fréquence attendue par les deux modèles. Ni l'un ni l'autre n'accepte autre chose : c'est
# une constante du couple de modèles, pas un réglage.
SAMPLE_RATE = 16000

DEFAULT_SEGMENTATION_MODEL = "/opt/diarization/segmentation.onnx"
DEFAULT_EMBEDDING_MODEL = "/opt/diarization/embedding.onnx"
# Deux fils suffisent : mesuré à 0,060x le temps réel sur cette machine. Au-delà, la passe
# dispute des cœurs à whisper, qui domine largement le coût du job.
DEFAULT_THREADS = 2
DEFAULT_CLUSTER_THRESHOLD = 0.5
# -1 : le clustering découvre lui-même le nombre de locuteurs.
AUTOMATIC_SPEAKERS = -1

# Bornes de la segmentation pyannote, en secondes : en deçà, un tour est du bruit et un
# silence n'en est pas un. Ce sont les valeurs de référence du modèle.
MIN_DURATION_ON = 0.3
MIN_DURATION_OFF = 0.5

FFMPEG_BIN = "ffmpeg"
# Décoder n'est pas transcrire : au-delà, ffmpeg est bloqué, pas lent.
DECODE_TIMEOUT_SECONDS = 30 * 60
# Plafond de durée décodée. La passe matérialise tout le signal en mémoire — environ
# 10 octets par échantillon au pic, soit ~576 Mio par heure d'audio. Le noyau tue un
# conteneur qui dépasse sa borne mémoire par SIGKILL, que rien ne rattrape en Python : ni
# le garde de la passe, ni celui du job. Un transcript déjà produit serait perdu, alors
# qu'il aboutissait avant cette passe. Le plafond est donc calé sur le plus PETIT worker de
# la flotte (3 Gio pour le worker GPU), pas sur le plus grand, et un dépassement devient un
# échec rattrapable : la diarisation est sautée, la transcription se conclut.
MAX_DECODED_SECONDS = 4 * 60 * 60

REQUIRED_MODULES = ("sherpa_onnx", "numpy")

# Enfant du journal du worker : même formateur JSON, même flux, aucune configuration en double.
LOGGER = logging.getLogger("wisper.worker.diarization")


def log(level, message, **fields):
    LOGGER.log(level, message, extra={"fields": fields})


class Unavailable(Exception):
    """Raison pour laquelle ce worker ne peut pas diariser. Jamais une panne : une capacité."""


class DiarizationError(Exception):
    """Échec de la passe sur un job. Le transcript, lui, reste bon."""


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
        # Variable posée mais vide : une faute de configuration, pas un choix du défaut.
        raise Unavailable("{} est vide".format(name))
    return _raw(environ, name) or default


def _positive_int(environ, name, default):
    raw = _raw(environ, name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise Unavailable("{} doit être un entier".format(name)) from None
    if value < 1:
        raise Unavailable("{} doit être supérieur ou égal à 1".format(name))
    return value


def _speaker_count(environ, name, default):
    """Un nombre de locuteurs : un entier >= 1, ou la sentinelle automatique.

    `AUTOMATIC_SPEAKERS` est la valeur que ce module désigne comme « laisse le clustering
    décider » : la refuser éteindrait toute la diarisation chez l'exploitant qui l'écrit
    précisément pour rendre ce choix explicite, et une ligne info serait le seul indice.
    """
    raw = _raw(environ, name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise Unavailable("{} doit être un entier".format(name)) from None
    if value != AUTOMATIC_SPEAKERS and value < 1:
        raise Unavailable(
            "{} doit valoir {} (automatique) ou un entier supérieur ou égal à 1".format(
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
        raise Unavailable("{} doit être un nombre".format(name)) from None
    if value <= 0:
        raise Unavailable("{} doit être strictement positif".format(name))
    return value


def load(environ, exists=os.path.exists, find_module=importlib.util.find_spec):
    """Rend un `Diarizer` prêt à l'emploi, ou `None` quand la capacité est absente.

    Appelé une seule fois au démarrage : sonder les modules et les fichiers à chaque job
    ne dirait jamais rien de neuf, et un worker qui ne diarise pas ne doit rien coûter.
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
            raise Unavailable("le module {} n'est pas installé".format(name))


def _require_models(config, exists):
    for path in (config.segmentation_model, config.embedding_model):
        if not exists(path):
            raise Unavailable("le modèle {} est absent".format(path))


class Diarizer:
    """Le moteur sherpa-onnx et son décodage, montés à la première passe puis réutilisés.

    Charger 45 Mio de poids ONNX coûte plusieurs secondes : ce serait du gaspillage à chaque
    job. Le worker traite un job à la fois, l'objet n'a donc jamais deux appels concurrents.
    """

    def __init__(self, config, engine_factory=None, decode=None, to_samples=None):
        self._config = config
        self._engine_factory = engine_factory if engine_factory is not None else build_engine
        self._decode = decode if decode is not None else decode_pcm
        # Dernière couture : la conversion en flottants est la seule chose ici qui exige
        # numpy. L'injecter garde le décodage, le ménage et cette boucle éprouvables sur un
        # Python nu — c'est ce que fait la CI, qui n'installe rien pour le worker.
        self._to_samples = to_samples if to_samples is not None else _as_float32
        self._engine = None

    def run(self, media_path, workdir):
        """Rend les tours de parole du média, en millisecondes, triés par début."""
        frames, sample_rate = self._decode(media_path, workdir)
        engine = self._engine
        if engine is None:
            engine = self._engine = self._engine_factory(self._config)
        if engine.sample_rate != sample_rate:
            raise DiarizationError(
                "le moteur attend {} Hz, le média a été décodé à {} Hz".format(
                    engine.sample_rate, sample_rate
                )
            )
        return to_turns(engine.process(self._to_samples(frames)).sort_by_start_time())


def _as_float32(frames):
    """Convertit des trames PCM 16 bits en flottants normalisés, ce que sherpa attend.

    numpy vit ici et nulle part ailleurs : c'est une dépendance de sherpa-onnx, donc elle
    est présente partout où le moteur tourne — et absente des tests, qui n'ont pas de
    moteur.

    `frombuffer` ne copie pas, `astype` produit l'unique copie, et la normalisation se fait
    EN PLACE : écrire `astype(...) / 32768.0` allouerait un second tableau flottant pendant
    que le premier vit encore, soit un pic de 10 octets par échantillon au lieu de 6.
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
        raise DiarizationError("configuration sherpa-onnx refusée")
    return sherpa_onnx.OfflineSpeakerDiarization(settings)


def to_turns(segments):
    """Traduit la sortie du moteur en tours du contrat HTTP.

    Millisecondes entières, début borné à zéro, tours vides écartés : le contrat exige
    `startMs >= 0` et `endMs > startMs`, et un modèle qui déborde de quelques centièmes ne
    doit pas transformer une passe réussie en 422.
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
    """Décode le média en PCM 16 kHz mono et rend `(trames 16 bits, fréquence)`.

    Le fichier intermédiaire vit dans le répertoire de travail du job — effacé avec lui —
    et est retiré dès la lecture faite, réussite ou échec : un WAV décompressé pèse plus
    lourd que le média d'origine.
    """
    handle, wav_path = tempfile.mkstemp(prefix="diarization-", suffix=".wav", dir=workdir)
    os.close(handle)
    try:
        # Liste d'arguments, jamais de shell. `-nostdin` : ffmpeg ne doit pas disputer
        # l'entrée standard au worker. `-y` : le fichier existe déjà, mkstemp l'a créé.
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
                # Ceinture : ffmpeg s'arrête au plafond, le WAV ne peut pas être plus long
                # que ce que la mémoire du worker tient.
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
        # `missing_ok` n'existe pas ici : ffmpeg peut avoir remplacé le fichier, jamais
        # l'avoir effacé. Un échec de ménage ne doit pas masquer l'échec du décodage.
        try:
            os.unlink(wav_path)
        except OSError:
            pass


def read_wav(path):
    """Rend `(trames PCM 16 bits signées, fréquence)`. Aucune dépendance tierce ici.

    La conversion en flottants appartient à `Diarizer.run`, au plus près de sherpa : c'est
    lui qui impose numpy, et lui seul. Le décodage, la lecture et le ménage restent donc
    éprouvables sur un Python nu — c'est ce que fait la CI.
    """
    with wave.open(path, "rb") as source:
        if source.getsampwidth() != 2 or source.getnchannels() != 1:
            raise DiarizationError("le décodage n'a pas produit du PCM 16 bits mono")
        sample_rate = source.getframerate()
        frame_count = source.getnframes()
        # Bretelles : ffmpeg a peut-être ignoré `-t`, ou le fichier ne vient pas de lui.
        # Le refus arrive AVANT d'allouer, seul moment où il peut encore être un échec
        # rattrapable plutôt qu'un SIGKILL du noyau.
        if frame_count > MAX_DECODED_SECONDS * max(1, sample_rate):
            raise DiarizationError(
                "média trop long pour être diarisé : {} s décodées, plafond {} s".format(
                    frame_count // max(1, sample_rate), MAX_DECODED_SECONDS
                )
            )
        frames = source.readframes(frame_count)
    return frames, sample_rate
