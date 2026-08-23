import { describe, expect, it } from 'vitest';

import { InvalidLanguageError, UnsupportedModelError } from './errors';
import { TranscriptionSettings, WHISPER_MODELS, isWhisperModel } from './transcription-settings';

describe('TranscriptionSettings', () => {
  it('accepts each of the known whisper models', () => {
    for (const model of WHISPER_MODELS) {
      expect(TranscriptionSettings.of(model, 'fr').model).toBe(model);
    }
  });

  it('rejects an unknown model', () => {
    expect(() => TranscriptionSettings.of('gigantic', 'fr')).toThrow(UnsupportedModelError);
    expect(() => TranscriptionSettings.of('', 'fr')).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_MODEL' }),
    );
  });

  it('accepts both the code and the full name of a language', () => {
    expect(TranscriptionSettings.of('small', 'fr').language).toBe('fr');
    expect(TranscriptionSettings.of('small', 'French').language).toBe('French');
  });

  it('rejects any language that is not a run of 2 to 32 letters', () => {
    for (const language of ['f', '', 'fr-FR', 'fr ', '--model', 'x'.repeat(33), '../etc']) {
      expect(() => TranscriptionSettings.of('small', language)).toThrow(InvalidLanguageError);
    }
  });

  it('recognizes a model served by a worker', () => {
    expect(isWhisperModel('turbo')).toBe(true);
    expect(isWhisperModel('turbo-xl')).toBe(false);
  });
});
