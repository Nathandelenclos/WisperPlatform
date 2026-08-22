import type { SegmentState } from '../domain/segment';
import type { TranscriptionStatus } from '../domain/transcription';
import type { WhisperModel } from '../domain/transcription-settings';

/**
 * Ce qu'un worker reçoit en réclamant du travail. Aucun nom de fichier, aucun propriétaire :
 * le worker n'apprend rien de l'utilisateur, il ne tient qu'un laissez-passer média.
 */
export type ClaimedJobView = {
  transcriptionId: string;
  runId: string;
  model: WhisperModel;
  language: string;
  mediaToken: string;
  leaseExpiresAt: Date;
};

/** Ce que le propriétaire voit d'une de ses transcriptions, segments compris. */
export type TranscriptionView = {
  id: string;
  status: TranscriptionStatus;
  model: WhisperModel;
  language: string;
  mediaName: string;
  mediaContentType: string;
  mediaByteSize: number;
  requestedAt: Date;
  completedAt: Date | null;
  failureReason: string | null;
  segments: SegmentState[];
};
