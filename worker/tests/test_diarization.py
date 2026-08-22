"""Passe de diarisation : capacité optionnelle, décodage, conversion des tours.

Aucun modèle ONNX, aucun réseau, aucun ffmpeg réel : le moteur sherpa-onnx et le décodeur
sont injectés. Ce qui est éprouvé ici, c'est ce que le worker décide, pas ce que sherpa calcule.
"""

import collections
import logging
import os
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
    def test_defauts_surs_quand_rien_n_est_pose(self):
        config = DiarizationConfig.from_environment({})

        self.assertEqual(DEFAULT_THREADS, config.threads)
        self.assertEqual(DEFAULT_CLUSTER_THRESHOLD, config.cluster_threshold)
        # -1 : le clustering découvre lui-même le nombre de locuteurs.
        self.assertEqual(-1, config.max_speakers)
        self.assertTrue(config.segmentation_model)
        self.assertTrue(config.embedding_model)

    def test_l_environnement_gagne_sur_les_defauts(self):
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

    def test_une_valeur_illisible_rend_la_capacite_absente_sans_exception(self):
        for variable, value in (
            ("WISPER_DIARIZATION_THREADS", "deux"),
            ("WISPER_DIARIZATION_THREADS", "0"),
            ("WISPER_DIARIZATION_MAX_SPEAKERS", "0"),
            ("WISPER_DIARIZATION_CLUSTER_THRESHOLD", "beaucoup"),
        ):
            with self.subTest(variable=variable, value=value):
                with self.assertLogs(diarization.LOGGER, logging.INFO) as captured:
                    self.assertIsNone(
                        load(dict(MODELS, **{variable: value}), exists=present, find_module=installed)
                    )
                self.assertEqual(1, len(captured.records))
                self.assertIn(variable, captured.records[0].fields["reason"])


class CapabilityTest(unittest.TestCase):
    """Un worker sans diarisation reste un worker : jamais d'exception, une ligne de journal."""

    def test_le_module_sherpa_absent_desactive_la_passe(self):
        with self.assertLogs(diarization.LOGGER, logging.INFO) as captured:
            self.assertIsNone(load(MODELS, exists=present, find_module=lambda _name: None))

        self.assertEqual(1, len(captured.records))
        record = captured.records[0]
        self.assertEqual(logging.INFO, record.levelno)
        self.assertEqual("diarization disabled", record.getMessage())
        self.assertIn("sherpa_onnx", record.fields["reason"])

    def test_numpy_absent_desactive_la_passe(self):
        with self.assertLogs(diarization.LOGGER, logging.INFO) as captured:
            self.assertIsNone(
                load(MODELS, exists=present, find_module=lambda name: None if name == "numpy" else object())
            )

        self.assertIn("numpy", captured.records[0].fields["reason"])

    def test_un_modele_manquant_desactive_la_passe(self):
        for missing in ("/models/segmentation.onnx", "/models/embedding.onnx"):
            with self.subTest(missing=missing):
                with self.assertLogs(diarization.LOGGER, logging.INFO) as captured:
                    self.assertIsNone(
                        load(MODELS, exists=lambda path: path != missing, find_module=installed)
                    )
                self.assertEqual(1, len(captured.records))
                self.assertIn(missing, captured.records[0].fields["reason"])

    def test_un_chemin_de_modele_vide_desactive_la_passe(self):
        with self.assertLogs(diarization.LOGGER, logging.INFO) as captured:
            self.assertIsNone(
                load(
                    dict(MODELS, WISPER_DIARIZATION_SEGMENTATION_MODEL="  "),
                    exists=present,
                    find_module=installed,
                )
            )

        self.assertIn("WISPER_DIARIZATION_SEGMENTATION_MODEL", captured.records[0].fields["reason"])

    def test_la_capacite_presente_rend_un_diariseur(self):
        with self.assertLogs(diarization.LOGGER, logging.INFO) as captured:
            diarizer = load(MODELS, exists=present, find_module=installed)

        self.assertIsInstance(diarizer, Diarizer)
        self.assertEqual("diarization enabled", captured.records[0].getMessage())


class TurnConversionTest(unittest.TestCase):
    def test_les_secondes_deviennent_des_millisecondes_arrondies(self):
        turns = to_turns([Segment(0.0, 1.2345, 0), Segment(1.2345, 3.5006, 1)])

        self.assertEqual(
            [
                {"startMs": 0, "endMs": 1234, "speaker": 0},
                {"startMs": 1234, "endMs": 3501, "speaker": 1},
            ],
            turns,
        )

    def test_les_tours_sont_tries_par_debut(self):
        turns = to_turns([Segment(4.0, 5.0, 1), Segment(0.5, 1.0, 0), Segment(2.0, 3.0, 2)])

        self.assertEqual([500, 2000, 4000], [turn["startMs"] for turn in turns])

    def test_un_tour_vide_ou_inverse_est_rejete(self):
        turns = to_turns(
            [
                Segment(1.0, 1.0, 0),  # durée nulle
                Segment(3.0, 2.0, 1),  # borné à l'envers
                Segment(2.0, 2.0004, 2),  # s'écrase à zéro à la milliseconde
                Segment(5.0, 6.0, 0),
            ]
        )

        self.assertEqual([{"startMs": 5000, "endMs": 6000, "speaker": 0}], turns)

    def test_un_debut_negatif_est_ramene_a_zero(self):
        # Le contrat HTTP exige `startMs >= 0` ; un modèle qui déborde ne doit pas
        # transformer une passe réussie en 422.
        self.assertEqual(
            [{"startMs": 0, "endMs": 900, "speaker": 0}], to_turns([Segment(-0.05, 0.9, 0)])
        )

    def test_aucun_tour_rend_une_liste_vide(self):
        self.assertEqual([], to_turns([]))


def write_wav(path, samples, sample_rate=SAMPLE_RATE, channels=1, width=2):
    with wave.open(path, "wb") as sink:
        sink.setnchannels(channels)
        sink.setsampwidth(width)
        sink.setframerate(sample_rate)
        sink.writeframes(b"".join(int(value).to_bytes(2, "little", signed=True) for value in samples))


class DecodeTest(unittest.TestCase):
    """`ffmpeg` est injecté : ce qui est éprouvé, c'est la commande, la lecture et le ménage."""

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

    def test_decode_en_pcm_16k_mono_normalise(self):
        samples, rate = diarization.decode_pcm(self.media, self.workdir, run=self._ffmpeg())

        self.assertEqual(SAMPLE_RATE, rate)
        self.assertEqual(3, len(samples))
        self.assertAlmostEqual(0.0, float(samples[0]))
        self.assertAlmostEqual(0.5, float(samples[1]))
        self.assertAlmostEqual(-1.0, float(samples[2]))
        self.assertEqual("float32", samples.dtype.name)

    def test_la_commande_impose_le_mono_16k_et_ne_lit_pas_stdin(self):
        diarization.decode_pcm(self.media, self.workdir, run=self._ffmpeg())

        command = self.commands[0]
        self.assertIn("-nostdin", command)
        self.assertEqual("1", command[command.index("-ac") + 1])
        self.assertEqual(str(SAMPLE_RATE), command[command.index("-ar") + 1])
        self.assertEqual(self.media, command[command.index("-i") + 1])
        self.assertEqual("pcm_s16le", command[command.index("-c:a") + 1])

    def test_le_fichier_temporaire_est_efface_meme_en_cas_d_echec(self):
        def explode(command, **_kwargs):
            self.commands.append(command)
            raise OSError("ffmpeg est parti")

        with self.assertRaises(OSError):
            diarization.decode_pcm(self.media, self.workdir, run=explode)

        self.assertEqual(["media"], os.listdir(self.workdir))

    def test_le_fichier_temporaire_est_efface_apres_un_decodage_reussi(self):
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
    def build(self, engine, samples=(0.0, 0.5), rate=SAMPLE_RATE):
        return Diarizer(
            DiarizationConfig.from_environment(MODELS),
            engine_factory=lambda _config: engine,
            decode=lambda _media, _workdir: (list(samples), rate),
        )

    def test_rend_les_tours_du_moteur_en_millisecondes(self):
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

    def test_le_moteur_n_est_construit_qu_une_fois(self):
        built = []

        def factory(config):
            built.append(config)
            return FakeEngine([])

        diarizer = Diarizer(
            DiarizationConfig.from_environment(MODELS),
            engine_factory=factory,
            decode=lambda _media, _workdir: ([0.0], SAMPLE_RATE),
        )
        diarizer.run("media", "workdir")
        diarizer.run("media", "workdir")

        self.assertEqual(1, len(built))

    def test_une_frequence_inattendue_est_refusee(self):
        engine = FakeEngine([], sample_rate=8000)

        with self.assertRaises(DiarizationError) as raised:
            self.build(engine).run("media", "workdir")

        self.assertIn("16000", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
