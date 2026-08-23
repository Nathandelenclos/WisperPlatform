"""Diarization pass: optional capability, decoding, turn conversion.

No ONNX model, no network, no real ffmpeg: the sherpa-onnx engine and the decoder are injected.
What is exercised here is what the worker decides, not what sherpa computes.
"""

import collections
import logging
import os
import struct
import tempfile
import unittest
import wave

import diarization
from diarization import (
    DEFAULT_CLUSTER_THRESHOLD,
    DEFAULT_THREADS,
    SAMPLE_RATE,
    DiarizationConfig,
    DiarizationError,
    Diarizer,
    load,
    to_turns,
)

Segment = collections.namedtuple("Segment", "start end speaker")

MODELS = {
    "WISPER_DIARIZATION_SEGMENTATION_MODEL": "/models/segmentation.onnx",
    "WISPER_DIARIZATION_EMBEDDING_MODEL": "/models/embedding.onnx",
}


def present(_path):
    return True


def installed(_name):
    return object()


class ConfigTest(unittest.TestCase):
    def test_safe_defaults_when_nothing_is_set(self):
        config = DiarizationConfig.from_environment({})

        self.assertEqual(DEFAULT_THREADS, config.threads)
        self.assertEqual(DEFAULT_CLUSTER_THRESHOLD, config.cluster_threshold)
        # -1: the clustering discovers the speaker count on its own.
        self.assertEqual(-1, config.max_speakers)
        self.assertTrue(config.segmentation_model)
        self.assertTrue(config.embedding_model)

    def test_the_environment_wins_over_the_defaults(self):
        config = DiarizationConfig.from_environment(
            dict(
                MODELS,
                WISPER_DIARIZATION_THREADS="4",
                WISPER_DIARIZATION_MAX_SPEAKERS="3",
                WISPER_DIARIZATION_CLUSTER_THRESHOLD="0.7",
            )
        )

        self.assertEqual("/models/segmentation.onnx", config.segmentation_model)
        self.assertEqual("/models/embedding.onnx", config.embedding_model)
        self.assertEqual(4, config.threads)
        self.assertEqual(3, config.max_speakers)
        self.assertEqual(0.7, config.cluster_threshold)

    def test_the_automatic_sentinel_is_an_acceptable_value(self):
        # -1 is what the module designates as "let the clustering decide": writing it
        # explicitly in one's .env must not switch off diarization in silence.
        diarizer = load(
            dict(MODELS, WISPER_DIARIZATION_MAX_SPEAKERS="-1"),
            exists=present,
            find_module=installed,
        )

        self.assertIsNotNone(diarizer)

    def test_an_unreadable_value_makes_the_capability_absent_without_raising(self):
        for variable, value in (
            ("WISPER_DIARIZATION_THREADS", "two"),
            ("WISPER_DIARIZATION_THREADS", "0"),
            ("WISPER_DIARIZATION_MAX_SPEAKERS", "0"),
            ("WISPER_DIARIZATION_CLUSTER_THRESHOLD", "plenty"),
        ):
            with self.subTest(variable=variable, value=value):
                with self.assertLogs(diarization.LOGGER, logging.INFO) as captured:
                    self.assertIsNone(
                        load(dict(MODELS, **{variable: value}), exists=present, find_module=installed)
                    )
                self.assertEqual(1, len(captured.records))
                self.assertIn(variable, captured.records[0].fields["reason"])


class CapabilityTest(unittest.TestCase):
    """A worker without diarization is still a worker: never an exception, one log line."""

    def test_a_missing_sherpa_module_disables_the_pass(self):
        with self.assertLogs(diarization.LOGGER, logging.INFO) as captured:
            self.assertIsNone(load(MODELS, exists=present, find_module=lambda _name: None))

        self.assertEqual(1, len(captured.records))
        record = captured.records[0]
        self.assertEqual(logging.INFO, record.levelno)
        self.assertEqual("diarization disabled", record.getMessage())
        self.assertIn("sherpa_onnx", record.fields["reason"])

    def test_a_missing_numpy_disables_the_pass(self):
        with self.assertLogs(diarization.LOGGER, logging.INFO) as captured:
            self.assertIsNone(
                load(MODELS, exists=present, find_module=lambda name: None if name == "numpy" else object())
            )

        self.assertIn("numpy", captured.records[0].fields["reason"])

    def test_a_missing_model_disables_the_pass(self):
        for missing in ("/models/segmentation.onnx", "/models/embedding.onnx"):
            with self.subTest(missing=missing):
                with self.assertLogs(diarization.LOGGER, logging.INFO) as captured:
                    self.assertIsNone(
                        load(MODELS, exists=lambda path: path != missing, find_module=installed)
                    )
                self.assertEqual(1, len(captured.records))
                self.assertIn(missing, captured.records[0].fields["reason"])

    def test_an_empty_model_path_disables_the_pass(self):
        with self.assertLogs(diarization.LOGGER, logging.INFO) as captured:
            self.assertIsNone(
                load(
                    dict(MODELS, WISPER_DIARIZATION_SEGMENTATION_MODEL="  "),
                    exists=present,
                    find_module=installed,
                )
            )

        self.assertIn("WISPER_DIARIZATION_SEGMENTATION_MODEL", captured.records[0].fields["reason"])

    def test_a_present_capability_returns_a_diarizer(self):
        with self.assertLogs(diarization.LOGGER, logging.INFO) as captured:
            diarizer = load(MODELS, exists=present, find_module=installed)

        self.assertIsInstance(diarizer, Diarizer)
        self.assertEqual("diarization enabled", captured.records[0].getMessage())


class TurnConversionTest(unittest.TestCase):
    def test_seconds_become_rounded_milliseconds(self):
        turns = to_turns([Segment(0.0, 1.2345, 0), Segment(1.2345, 3.5006, 1)])

        self.assertEqual(
            [
                {"startMs": 0, "endMs": 1234, "speaker": 0},
                {"startMs": 1234, "endMs": 3501, "speaker": 1},
            ],
            turns,
        )

    def test_the_turns_are_sorted_by_start(self):
        turns = to_turns([Segment(4.0, 5.0, 1), Segment(0.5, 1.0, 0), Segment(2.0, 3.0, 2)])

        self.assertEqual([500, 2000, 4000], [turn["startMs"] for turn in turns])

    def test_an_empty_or_reversed_turn_is_rejected(self):
        turns = to_turns(
            [
                Segment(1.0, 1.0, 0),  # zero duration
                Segment(3.0, 2.0, 1),  # bounds the wrong way round
                Segment(2.0, 2.0004, 2),  # collapses to zero at millisecond resolution
                Segment(5.0, 6.0, 0),
            ]
        )

        self.assertEqual([{"startMs": 5000, "endMs": 6000, "speaker": 0}], turns)

    def test_a_negative_start_is_clamped_to_zero(self):
        # The HTTP contract requires `startMs >= 0`; a model that overshoots must not turn a
        # successful pass into a 422.
        self.assertEqual(
            [{"startMs": 0, "endMs": 900, "speaker": 0}], to_turns([Segment(-0.05, 0.9, 0)])
        )

    def test_no_turn_returns_an_empty_list(self):
        self.assertEqual([], to_turns([]))


def write_wav(path, samples, sample_rate=SAMPLE_RATE, channels=1, width=2):
    with wave.open(path, "wb") as sink:
        sink.setnchannels(channels)
        sink.setsampwidth(width)
        sink.setframerate(sample_rate)
        sink.writeframes(b"".join(int(value).to_bytes(2, "little", signed=True) for value in samples))


class DecodeTest(unittest.TestCase):
    """`ffmpeg` is injected: what is exercised is the command, the read and the cleanup."""

    def setUp(self):
        self.workdir = tempfile.mkdtemp(prefix="wisper-diar-tests-")
        self.addCleanup(self._clean)
        self.media = os.path.join(self.workdir, "media")
        with open(self.media, "wb") as sink:
            sink.write(b"pretend-this-is-an-audio-file")
        self.commands = []

    def _clean(self):
        for name in os.listdir(self.workdir):
            os.unlink(os.path.join(self.workdir, name))
        os.rmdir(self.workdir)

    def _ffmpeg(self, samples=(0, 16384, -32768)):
        def run(command, **_kwargs):
            self.commands.append(command)
            write_wav(command[-1], samples)

        return run

    def test_decodes_to_16k_mono_pcm(self):
        frames, rate = diarization.decode_pcm(self.media, self.workdir, run=self._ffmpeg())

        self.assertEqual(SAMPLE_RATE, rate)
        # Three signed 16-bit little-endian samples: what sherpa will receive after
        # conversion, and what the read must return without depending on numpy.
        self.assertEqual(struct.pack("<3h", 0, 16384, -32768), frames)

    def test_the_command_forces_16k_mono_and_does_not_read_stdin(self):
        diarization.decode_pcm(self.media, self.workdir, run=self._ffmpeg())

        command = self.commands[0]
        self.assertIn("-nostdin", command)
        self.assertEqual("1", command[command.index("-ac") + 1])
        self.assertEqual(str(SAMPLE_RATE), command[command.index("-ar") + 1])
        self.assertEqual(self.media, command[command.index("-i") + 1])
        self.assertEqual("pcm_s16le", command[command.index("-c:a") + 1])

    def test_the_command_bounds_the_decoded_duration(self):
        diarization.decode_pcm(self.media, self.workdir, run=self._ffmpeg())

        command = self.commands[0]
        self.assertEqual(str(diarization.MAX_DECODED_SECONDS), command[command.index("-t") + 1])

    def test_a_wav_longer_than_the_ceiling_is_refused_before_any_allocation(self):
        # This refusal is what separates a recoverable failure — diarization is skipped, the
        # transcript concludes — from a kernel SIGKILL, which nothing catches.
        long_wav = os.path.join(self.workdir, "long.wav")
        with wave.open(long_wav, "wb") as sink:
            sink.setnchannels(1)
            sink.setsampwidth(2)
            # One second's worth of frames, but a declared rate of one sample per second:
            # the file claims to last longer than the ceiling without weighing much.
            sink.setframerate(1)
            sink.writeframes(b"\x00\x00" * (diarization.MAX_DECODED_SECONDS + 1))

        with self.assertRaises(DiarizationError) as raised:
            diarization.read_wav(long_wav)

        self.assertIn(str(diarization.MAX_DECODED_SECONDS), str(raised.exception))

    def test_removes_the_temporary_file_even_on_failure(self):
        def explode(command, **_kwargs):
            self.commands.append(command)
            raise OSError("ffmpeg is gone")

        with self.assertRaises(OSError):
            diarization.decode_pcm(self.media, self.workdir, run=explode)

        self.assertEqual(["media"], os.listdir(self.workdir))

    def test_removes_the_temporary_file_after_a_successful_decode(self):
        diarization.decode_pcm(self.media, self.workdir, run=self._ffmpeg())

        self.assertEqual(["media"], os.listdir(self.workdir))


class FakeResult:
    def __init__(self, segments):
        self._segments = segments
        self.sorted = False

    def sort_by_start_time(self):
        self.sorted = True
        return self._segments


class FakeEngine:
    def __init__(self, segments, sample_rate=SAMPLE_RATE):
        self.sample_rate = sample_rate
        self.result = FakeResult(segments)
        self.calls = []

    def process(self, samples):
        self.calls.append(samples)
        return self.result


class DiarizerRunTest(unittest.TestCase):
    def build(self, engine, frames=b"\x00\x00\x00\x40", rate=SAMPLE_RATE):
        return Diarizer(
            DiarizationConfig.from_environment(MODELS),
            engine_factory=lambda _config: engine,
            decode=lambda _media, _workdir: (frames, rate),
            # numpy belongs to the real engine: here we track the frames as they are.
            to_samples=lambda frames: frames,
        )

    def test_returns_the_engine_turns_in_milliseconds(self):
        engine = FakeEngine([Segment(0.0, 1.0, 0), Segment(1.0, 2.0, 1)])

        turns = self.build(engine).run("media", "workdir")

        self.assertEqual(
            [
                {"startMs": 0, "endMs": 1000, "speaker": 0},
                {"startMs": 1000, "endMs": 2000, "speaker": 1},
            ],
            turns,
        )
        self.assertTrue(engine.result.sorted)

    def test_the_engine_is_built_only_once(self):
        built = []

        def factory(config):
            built.append(config)
            return FakeEngine([])

        diarizer = Diarizer(
            DiarizationConfig.from_environment(MODELS),
            engine_factory=factory,
            decode=lambda _media, _workdir: (b"\x00\x00", SAMPLE_RATE),
            to_samples=lambda frames: frames,
        )
        diarizer.run("media", "workdir")
        diarizer.run("media", "workdir")

        self.assertEqual(1, len(built))

    def test_an_unexpected_sample_rate_is_refused(self):
        engine = FakeEngine([], sample_rate=8000)

        with self.assertRaises(DiarizationError) as raised:
            self.build(engine).run("media", "workdir")

        self.assertIn("16000", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
