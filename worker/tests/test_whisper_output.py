"""Parsing of the whisper verbose output and batching."""

import unittest

import wisper_worker
from whisper_output import SegmentBatcher, parse_segment_line


class ParseSegmentLineTest(unittest.TestCase):
    def test_reads_a_line_without_hours(self):
        segment = parse_segment_line("[00:00.000 --> 00:02.400] Hello and welcome.")

        self.assertEqual(
            {"startMs": 0, "endMs": 2400, "text": "Hello and welcome."}, segment
        )

    def test_reads_a_line_with_hours(self):
        segment = parse_segment_line("[01:02:03.456 --> 01:02:04.789] Still here.")

        self.assertEqual(3_723_456, segment["startMs"])
        self.assertEqual(3_724_789, segment["endMs"])

    def test_reads_a_line_past_a_hundred_hours(self):
        segment = parse_segment_line("[100:00:00.000 --> 100:00:01.000] Very long media.")

        self.assertEqual(360_000_000, segment["startMs"])
        self.assertEqual(360_001_000, segment["endMs"])

    def test_strips_the_text_and_keeps_the_inner_spacing(self):
        segment = parse_segment_line("[00:00.000 --> 00:01.000]   Two  words   \n")

        self.assertEqual("Two  words", segment["text"])

    def test_ignores_noise_lines(self):
        noise = [
            "",
            "\n",
            "Detecting language using up to the first 30 seconds.",
            "Detected language: French",
            "  0%|          | 0/1234 [00:00<?, ?frames/s]",
            "[00:00.000 --> unbounded text] nothing",
            "[00:00.00 --> 00:01.000] truncated milliseconds",
            "00:00.000 --> 00:01.000 without brackets",
        ]

        self.assertEqual([], [line for line in noise if parse_segment_line(line) is not None])

    def test_ignores_a_segment_without_text(self):
        self.assertIsNone(parse_segment_line("[00:00.000 --> 00:01.000]    "))

    def test_ignores_an_instantaneous_segment(self):
        # whisper prints these segments then erases them: the API would reject them.
        self.assertIsNone(parse_segment_line("[00:03.000 --> 00:03.000] Breath."))
        self.assertIsNone(parse_segment_line("[00:04.000 --> 00:03.000] Reversed bounds."))


class FakeClock:
    def __init__(self):
        self.value = 0.0

    def __call__(self):
        return self.value

    def advance(self, seconds):
        self.value += seconds


def segment(index):
    return {"startMs": index * 1000, "endMs": index * 1000 + 900, "text": "n{}".format(index)}


class SegmentBatcherTest(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self.batcher = SegmentBatcher(max_segments=10, max_seconds=5.0, monotonic=self.clock)

    def test_holds_segments_below_both_thresholds(self):
        self.assertEqual([None] * 9, [self.batcher.add(segment(index)) for index in range(9)])

    def test_releases_a_batch_at_the_size_threshold(self):
        for index in range(9):
            self.batcher.add(segment(index))

        batch = self.batcher.add(segment(9))

        self.assertEqual(10, len(batch))
        self.assertEqual("n0", batch[0]["text"])
        self.assertIsNone(self.batcher.flush())

    def test_releases_a_batch_at_the_time_threshold_without_any_new_segment(self):
        self.batcher.add(segment(0))
        self.clock.advance(4.9)
        self.assertIsNone(self.batcher.due())

        self.clock.advance(0.1)

        self.assertEqual(1, len(self.batcher.due()))

    def test_releases_a_batch_when_a_late_segment_crosses_the_time_threshold(self):
        self.batcher.add(segment(0))
        self.clock.advance(6.0)

        self.assertEqual(2, len(self.batcher.add(segment(1))))

    def test_restarts_the_window_after_a_batch(self):
        self.batcher.add(segment(0))
        self.clock.advance(6.0)
        self.batcher.due()

        self.batcher.add(segment(1))
        self.clock.advance(1.0)

        self.assertIsNone(self.batcher.due())
        self.assertEqual(4.0, self.batcher.seconds_until_due())

    def test_reports_no_deadline_when_nothing_is_pending(self):
        self.assertIsNone(self.batcher.seconds_until_due())
        self.assertIsNone(self.batcher.due())
        self.assertIsNone(self.batcher.flush())

    def test_flushes_the_remainder_at_end_of_stream(self):
        self.batcher.add(segment(0))
        self.batcher.add(segment(1))

        self.assertEqual(2, len(self.batcher.flush()))
        self.assertIsNone(self.batcher.flush())


if __name__ == "__main__":
    unittest.main()


class ExplainFailureTest(unittest.TestCase):
    """Translating the stderr tail: "code 1" says nothing, these reasons say what to do."""

    def test_names_a_gpu_memory_exhaustion(self):
        tail = [
            "torch.OutOfMemoryError: CUDA out of memory. Tried to allocate 20.00 MiB.",
            "GPU 0 has a total capacity of 3.94 GiB of which 19.75 MiB is free.",
        ]

        self.assertEqual("model too large for this worker", wisper_worker.explain_failure(1, tail))

    def test_names_a_card_that_is_too_old(self):
        tail = ["RuntimeError: CUDA error: no kernel image is available for execution on the device"]

        self.assertEqual(
            "model unsupported by this worker's gpu", wisper_worker.explain_failure(1, tail)
        )

    def test_names_an_undecodable_media(self):
        tail = ["ffmpeg: Invalid data found when processing input"]

        self.assertEqual("media could not be decoded", wisper_worker.explain_failure(1, tail))

    def test_an_unknown_cause_returns_the_raw_code(self):
        tail = ["Traceback (most recent call last):", "KeyError: 'segments'"]

        self.assertEqual("whisper exited with code 3", wisper_worker.explain_failure(3, tail))

    def test_an_empty_output_returns_the_raw_code(self):
        self.assertEqual("whisper exited with code 1", wisper_worker.explain_failure(1, []))
