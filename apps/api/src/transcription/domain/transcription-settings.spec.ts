import { describe, expect, it } from 'vitest';

import { InvalidLanguageError, UnsupportedModelError } from './errors';
import { TranscriptionSettings, WHISPER_MODELS, isWhisperModel } from './transcription-settings';

describe('TranscriptionSettings', () => {
  it('accepte chacun des modèles whisper connus', () => {
    for (const model of WHISPER_MODELS) {
      expect(TranscriptionSettings.of(model, 'fr').model).toBe(model);
    }
  });

  it('refuse un modèle inconnu', () => {
    expect(() => TranscriptionSettings.of('gigantic', 'fr')).toThrow(UnsupportedModelError);
    expect(() => TranscriptionSettings.of('', 'fr')).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_MODEL' }),
    );
  });

  it('accepte le code comme le nom complet d\'une langue', () => {
    expect(TranscriptionSettings.of('small', 'fr').language).toBe('fr');
    expect(TranscriptionSettings.of('small', 'French').language).toBe('French');
  });

  it('refuse toute langue qui n\'est pas une suite de 2 à 32 lettres', () => {
    for (const language of ['f', '', 'fr-FR', 'fr ', '--model', 'x'.repeat(33), '../etc']) {
      expect(() => TranscriptionSettings.of('small', language)).toThrow(InvalidLanguageError);
    }
  });

  it('reconnaît un modèle servi par un worker', () => {
    expect(isWhisperModel('turbo')).toBe(true);
    expect(isWhisperModel('turbo-xl')).toBe(false);
  });
});
