"""Parsing de la sortie verbose de whisper et découpage en lots."""

import unittest

import wisper_worker
from whisper_output import SegmentBatcher, parse_segment_line


class ParseSegmentLineTest(unittest.TestCase):
    def test_reads_a_line_without_hours(self):
        segment = parse_segment_line("[00:00.000 --> 00:02.400] Bonjour et bienvenue.")

        self.assertEqual(
            {"startMs": 0, "endMs": 2400, "text": "Bonjour et bienvenue."}, segment
        )

    def test_reads_a_line_with_hours(self):
        segment = parse_segment_line("[01:02:03.456 --> 01:02:04.789] Toujours la.")

        self.assertEqual(3_723_456, segment["startMs"])
        self.assertEqual(3_724_789, segment["endMs"])

    def test_reads_a_line_past_a_hundred_hours(self):
        segment = parse_segment_line("[100:00:00.000 --> 100:00:01.000] Tres long media.")

        self.assertEqual(360_000_000, segment["startMs"])
        self.assertEqual(360_001_000, segment["endMs"])

    def test_strips_the_text_and_keeps_the_inner_spacing(self):
        segment = parse_segment_line("[00:00.000 --> 00:01.000]   Deux  mots   \n")

        self.assertEqual("Deux  mots", segment["text"])

    def test_ignores_noise_lines(self):
        noise = [
            "",
            "\n",
            "Detecting language using up to the first 30 seconds.",
            "Detected language: French",
            "  0%|          | 0/1234 [00:00<?, ?frames/s]",
            "[00:00.000 --> texte sans borne] rien",
            "[00:00.00 --> 00:01.000] millisecondes tronquees",
            "00:00.000 --> 00:01.000 sans crochets",
        ]

        self.assertEqual([], [line for line in noise if parse_segment_line(line) is not None])

    def test_ignores_a_segment_without_text(self):
        self.assertIsNone(parse_segment_line("[00:00.000 --> 00:01.000]    "))

    def test_ignores_an_instantaneous_segment(self):
        # whisper imprime ces segments puis les efface : l'API les refuserait.
        self.assertIsNone(parse_segment_line("[00:03.000 --> 00:03.000] Souffle."))
        self.assertIsNone(parse_segment_line("[00:04.000 --> 00:03.000] Bornes inversees."))


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
    """Traduction de la fin de stderr : « code 1 » ne dit rien, ces raisons-là disent quoi faire."""

    def test_une_saturation_de_memoire_gpu_est_nommee(self):
        tail = [
            "torch.OutOfMemoryError: CUDA out of memory. Tried to allocate 20.00 MiB.",
            "GPU 0 has a total capacity of 3.94 GiB of which 19.75 MiB is free.",
        ]

        self.assertEqual("model too large for this worker", wisper_worker.explain_failure(1, tail))

    def test_une_carte_trop_ancienne_est_nommee(self):
        tail = ["RuntimeError: CUDA error: no kernel image is available for execution on the device"]

        self.assertEqual(
            "model unsupported by this worker's gpu", wisper_worker.explain_failure(1, tail)
        )

    def test_un_media_indecodable_est_nomme(self):
        tail = ["ffmpeg: Invalid data found when processing input"]

        self.assertEqual("media could not be decoded", wisper_worker.explain_failure(1, tail))

    def test_une_cause_inconnue_rend_le_code_brut(self):
        tail = ["Traceback (most recent call last):", "KeyError: 'segments'"]

        self.assertEqual("whisper exited with code 3", wisper_worker.explain_failure(3, tail))

    def test_une_sortie_vide_rend_le_code_brut(self):
        self.assertEqual("whisper exited with code 1", wisper_worker.explain_failure(1, []))
