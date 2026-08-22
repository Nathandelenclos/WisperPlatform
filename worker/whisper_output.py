"""Parsing incrémental de la sortie verbose du CLI whisper.

Format vérifié dans la source installée (`whisper/transcribe.py`) :

    line = f"[{format_timestamp(start)} --> {format_timestamp(end)}] {text}"

et `format_timestamp` (`whisper/utils.py`) rend `MM:SS.mmm`, préfixé de `HH:` uniquement
lorsque l'heure est non nulle.

Bibliothèque standard uniquement : `whisper` est un binaire externe, jamais un import.
"""

from __future__ import annotations

import re
import time

# Seuils de découpage en lots : un lot part dès 10 segments accumulés ou 5 secondes écoulées.
BATCH_MAX_SEGMENTS = 10
BATCH_MAX_SECONDS = 5.0

_SEGMENT_LINE = re.compile(
    r"^\s*\["
    r"(?:(?P<start_hours>\d{2,}):)?(?P<start_minutes>\d{2}):(?P<start_seconds>\d{2})\.(?P<start_millis>\d{3})"
    r"\s*-->\s*"
    r"(?:(?P<end_hours>\d{2,}):)?(?P<end_minutes>\d{2}):(?P<end_seconds>\d{2})\.(?P<end_millis>\d{3})"
    r"\]\s?(?P<text>.*?)\s*$"
)


def parse_segment_line(line):
    """Rend `{'startMs', 'endMs', 'text'}`, ou `None` si la ligne n'est pas un segment.

    Sont écartées : les lignes de bruit (détection de langue, avertissements, barres de
    progression), les segments au texte vide et les segments instantanés — whisper les
    imprime avant de les effacer lui-même (`transcribe.py`, « if a segment is instantaneous
    or does not contain text, clear it »), et l'API les refuserait comme intervalle invalide.
    """
    match = _SEGMENT_LINE.match(line)
    if match is None:
        return None
    text = match.group("text").strip()
    if not text:
        return None
    start_ms = _to_milliseconds(match, "start")
    end_ms = _to_milliseconds(match, "end")
    if end_ms <= start_ms:
        return None
    return {"startMs": start_ms, "endMs": end_ms, "text": text}


def _to_milliseconds(match, prefix):
    hours = int(match.group(prefix + "_hours") or 0)
    minutes = int(match.group(prefix + "_minutes"))
    seconds = int(match.group(prefix + "_seconds"))
    millis = int(match.group(prefix + "_millis"))
    return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis


class SegmentBatcher:
    """Accumule les segments et rend un lot dès le seuil de taille ou de temps.

    L'horloge est injectable pour les tests ; `monotonic` évite tout saut d'horloge murale.
    """

    def __init__(
        self,
        max_segments=BATCH_MAX_SEGMENTS,
        max_seconds=BATCH_MAX_SECONDS,
        monotonic=time.monotonic,
    ):
        self._max_segments = max_segments
        self._max_seconds = max_seconds
        self._monotonic = monotonic
        self._pending = []
        self._opened_at = None

    def add(self, segment):
        """Ajoute un segment ; rend le lot s'il atteint un seuil, sinon `None`."""
        if not self._pending:
            self._opened_at = self._monotonic()
        self._pending.append(segment)
        if len(self._pending) >= self._max_segments or self._elapsed() >= self._max_seconds:
            return self.flush()
        return None

    def due(self):
        """Rend le lot en attente si le seuil de temps est atteint, sinon `None`.

        À appeler quand aucune ligne n'arrive : un silence prolongé ne doit pas retenir
        indéfiniment des segments déjà transcrits.
        """
        if self._pending and self._elapsed() >= self._max_seconds:
            return self.flush()
        return None

    def flush(self):
        """Rend le lot en attente sans condition (fin de flux), ou `None` s'il est vide."""
        if not self._pending:
            return None
        batch = self._pending
        self._pending = []
        self._opened_at = None
        return batch

    def seconds_until_due(self):
        """Secondes restantes avant l'échéance du lot courant, ou `None` s'il n'y en a pas."""
        if not self._pending:
            return None
        return max(0.0, self._max_seconds - self._elapsed())

    def _elapsed(self):
        if self._opened_at is None:
            return 0.0
        return self._monotonic() - self._opened_at
