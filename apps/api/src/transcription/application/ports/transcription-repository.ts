import type { Transcription } from '../../domain/transcription';

/**
 * Repository of the `Transcription` aggregate. `save` writes the WHOLE aggregate — header and
 * segments — in a single transaction: that is what makes applying a batch idempotent on replay.
 */
export interface TranscriptionRepository {
  save(transcription: Transcription): Promise<void>;
  findById(id: string): Promise<Transcription | null>;
}

export const TRANSCRIPTION_REPOSITORY = Symbol('TranscriptionRepository');
