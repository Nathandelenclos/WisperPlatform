#!/usr/bin/env python3
"""Fake `whisper` binary, usable as is through `WHISPER_BIN`.

Mimics the verbose output of the real CLI — noise lines included — then writes the expected
JSON file into `--output_dir` and exits 0. Allows end-to-end verification without a GPU.

Modes triggered by the environment:
  FAKE_WHISPER_FAIL=1            exits 3 after two segments (`fail` path)
  FAKE_WHISPER_HANG_SECONDS=N    sleeps N seconds after two segments (shutdown/SIGTERM path)
  FAKE_WHISPER_SEGMENTS=N        number of emitted segments (default 12)
"""

import argparse
import json
import os
import sys
import time

SEGMENT_SECONDS = 2
LINE_DELAY_SECONDS = 0.02


def format_timestamp(seconds):
    """Same rule as `whisper.utils.format_timestamp`: `HH:` only when the hour exists."""
    milliseconds = round(seconds * 1000.0)
    hours, milliseconds = divmod(milliseconds, 3_600_000)
    minutes, milliseconds = divmod(milliseconds, 60_000)
    whole_seconds, milliseconds = divmod(milliseconds, 1000)
    prefix = "{:02d}:".format(hours) if hours > 0 else ""
    return "{}{:02d}:{:02d}.{:03d}".format(prefix, minutes, whole_seconds, milliseconds)


def emit(line):
    print(line, flush=True)
    time.sleep(LINE_DELAY_SECONDS)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("media")
    parser.add_argument("--model", default="tiny")
    parser.add_argument("--language", default="fr")
    parser.add_argument("--output_format", default="json")
    parser.add_argument("--output_dir", default=".")
    parser.add_argument("--verbose", default="True")
    parser.add_argument("--model_dir", default=None)
    options, _ = parser.parse_known_args()

    total = int(os.environ.get("FAKE_WHISPER_SEGMENTS", "12"))
    emit("Detecting language using up to the first 30 seconds. Use `--language` to specify the language")
    emit("Detected language: French")

    segments = []
    for index in range(total):
        start = index * SEGMENT_SECONDS
        end = start + SEGMENT_SECONDS
        text = "Segment number {}.".format(index + 1)
        emit("[{} --> {}] {}".format(format_timestamp(start), format_timestamp(end), text))
        segments.append({"id": index, "start": float(start), "end": float(end), "text": " " + text})

        if index == 1 and os.environ.get("FAKE_WHISPER_FAIL") == "1":
            print("fake whisper: forced failure", file=sys.stderr, flush=True)
            return 3
        if index == 1 and os.environ.get("FAKE_WHISPER_HANG_SECONDS"):
            time.sleep(float(os.environ["FAKE_WHISPER_HANG_SECONDS"]))

    stem = os.path.splitext(os.path.basename(options.media))[0]
    destination = os.path.join(options.output_dir, stem + ".json")
    with open(destination, "w", encoding="utf-8") as sink:
        json.dump(
            {
                "text": " ".join(segment["text"].strip() for segment in segments),
                "segments": segments,
                "language": options.language,
            },
            sink,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
