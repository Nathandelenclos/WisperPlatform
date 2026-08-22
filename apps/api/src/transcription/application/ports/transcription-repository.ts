import type { Transcription } from '../../domain/transcription';

/**
 * Dépôt de l'aggregate `Transcription`. `save` écrit l'aggregate ENTIER — en-tête et segments —
 * dans une seule transaction : c'est ce qui rend l'application d'un lot idempotente au rejeu.
 */
export interface TranscriptionRepository {
  save(transcription: Transcription): Promise<void>;
  findById(id: string): Promise<Transcription | null>;
}

export const TRANSCRIPTION_REPOSITORY = Symbol('TranscriptionRepository');
