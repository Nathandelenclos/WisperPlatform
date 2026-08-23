import { InvalidLanguageError, UnsupportedModelError } from './errors';

export const WHISPER_MODELS = ['tiny', 'base', 'small', 'medium', 'large', 'turbo'] as const;
export type WhisperModel = (typeof WHISPER_MODELS)[number];

/**
 * The language ends up as a process argument on the worker side: that is a trust boundary.
 * So we only accept letters, which covers `fr` as well as `French`.
 */
const LANGUAGE_PATTERN = /^[A-Za-z]{2,32}$/;

export function isWhisperModel(candidate: string): candidate is WhisperModel {
  return (WHISPER_MODELS as readonly string[]).includes(candidate);
}

/** Engine choice for a transcription: whisper model and spoken language. */
export class TranscriptionSettings {
  private constructor(
    readonly model: WhisperModel,
    readonly language: string,
  ) {
    Object.freeze(this);
  }

  static of(model: string, language: string): TranscriptionSettings {
    if (!isWhisperModel(model)) {
      throw new UnsupportedModelError(`unknown transcription model: ${model}`);
    }
    if (!LANGUAGE_PATTERN.test(language)) {
      throw new InvalidLanguageError(
        'the language must be made of 2 to 32 letters, with no space or punctuation',
      );
    }
    return new TranscriptionSettings(model, language);
  }
}
