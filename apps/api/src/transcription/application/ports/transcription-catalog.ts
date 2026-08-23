import type { Placement } from '../../domain/placement';
import type { TranscriptionStatus } from '../../domain/transcription';
import type { WhisperModel } from '../../domain/transcription-settings';

/**
 * Read model of a transcription for the owner's list.
 * `durationMs` is the end of the last known segment (0 with no segment): the real duration of
 * the media is never measured, only the transcribed content is known.
 */
export type TranscriptionSummary = {
  id: string;
  status: TranscriptionStatus;
  /** The library must be able to say "waiting for your machine". */
  placement: Placement;
  model: WhisperModel;
  language: string;
  mediaName: string;
  mediaByteSize: number;
  segmentCount: number;
  durationMs: number;
  requestedAt: Date;
  completedAt: Date | null;
  failureReason: string | null;
};

/** Read side: an owner's transcriptions, from the most recent to the oldest. */
export interface TranscriptionCatalog {
  listOwnedBy(ownerId: string): Promise<TranscriptionSummary[]>;
}

export const TRANSCRIPTION_CATALOG = Symbol('TranscriptionCatalog');
