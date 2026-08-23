"""Incremental parsing of the whisper CLI verbose output.

Format checked against the installed source (`whisper/transcribe.py`):

    line = f"[{format_timestamp(start)} --> {format_timestamp(end)}] {text}"

and `format_timestamp` (`whisper/utils.py`) yields `MM:SS.mmm`, prefixed with `HH:` only when
the hour is non-zero.

Standard library only: `whisper` is an external binary, never an import.
"""

from __future__ import annotations

import re
import time

# Batching thresholds: a batch leaves as soon as 10 segments have piled up or 5 seconds elapsed.
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
    """Returns `{'startMs', 'endMs', 'text'}`, or `None` if the line is not a segment.

    Discarded: noise lines (language detection, warnings, progress bars), segments with empty
    text, and instantaneous segments — whisper prints those before erasing them itself
    (`transcribe.py`, "if a segment is instantaneous or does not contain text, clear it"), and
    the API would reject them as an invalid interval.
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
    """Accumulates segments and yields a batch as soon as the size or time threshold is hit.

    The clock is injectable for tests; `monotonic` avoids any wall-clock jump.
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
        """Adds a segment; returns the batch if it reaches a threshold, otherwise `None`."""
        if not self._pending:
            self._opened_at = self._monotonic()
        self._pending.append(segment)
        if len(self._pending) >= self._max_segments or self._elapsed() >= self._max_seconds:
            return self.flush()
        return None

    def due(self):
        """Returns the pending batch if the time threshold is reached, otherwise `None`.

        To be called when no line arrives: a prolonged silence must not hold already
        transcribed segments back indefinitely.
        """
        if self._pending and self._elapsed() >= self._max_seconds:
            return self.flush()
        return None

    def flush(self):
        """Returns the pending batch unconditionally (end of stream), or `None` if empty."""
        if not self._pending:
            return None
        batch = self._pending
        self._pending = []
        self._opened_at = None
        return batch

    def seconds_until_due(self):
        """Seconds left before the current batch is due, or `None` if there is no batch."""
        if not self._pending:
            return None
        return max(0.0, self._max_seconds - self._elapsed())

    def _elapsed(self):
        if self._opened_at is None:
            return 0.0
        return self._monotonic() - self._opened_at
