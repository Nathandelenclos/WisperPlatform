import { InvalidLanguageError, UnsupportedModelError } from './errors';

export const WHISPER_MODELS = ['tiny', 'base', 'small', 'medium', 'large', 'turbo'] as const;
export type WhisperModel = (typeof WHISPER_MODELS)[number];

/**
 * La langue finit en argument de processus côté worker : c'est une frontière de confiance.
 * On n'accepte donc que des lettres, ce qui couvre `fr` comme `French`.
 */
const LANGUAGE_PATTERN = /^[A-Za-z]{2,32}$/;

export function isWhisperModel(candidate: string): candidate is WhisperModel {
  return (WHISPER_MODELS as readonly string[]).includes(candidate);
}

/** Choix de moteur pour une transcription : modèle whisper et langue parlée. */
export class TranscriptionSettings {
  private constructor(
    readonly model: WhisperModel,
    readonly language: string,
  ) {
    Object.freeze(this);
  }

  static of(model: string, language: string): TranscriptionSettings {
    if (!isWhisperModel(model)) {
      throw new UnsupportedModelError(`modèle de transcription inconnu : ${model}`);
    }
    if (!LANGUAGE_PATTERN.test(language)) {
      throw new InvalidLanguageError(
        'la langue doit être composée de 2 à 32 lettres, sans espace ni ponctuation',
      );
    }
    return new TranscriptionSettings(model, language);
  }
}
