import type { Placement } from '../domain/placement';
import type { SegmentState } from '../domain/segment';
import type { SpeakerState } from '../domain/speaker';
import type { TranscriptionState, TranscriptionStatus } from '../domain/transcription';
import type { WhisperModel } from '../domain/transcription-settings';

/**
 * What a worker receives when it claims work. No file name, no owner: the worker learns
 * nothing about the user, it only holds a media pass.
 */
export type ClaimedJobView = {
  transcriptionId: string;
  runId: string;
  model: WhisperModel;
  language: string;
  mediaToken: string;
  leaseExpiresAt: Date;
};

/** What the owner sees of one of their transcriptions, segments included. */
export type TranscriptionView = {
  id: string;
  status: TranscriptionStatus;
  placement: Placement;
  model: WhisperModel;
  language: string;
  mediaName: string;
  mediaContentType: string;
  mediaByteSize: number;
  requestedAt: Date;
  completedAt: Date | null;
  failureReason: string | null;
  segments: SegmentState[];
  speakers: SpeakerState[];
};

/**
 * Projection from the aggregate to what the owner sees. It lives here, in a single
 * place: two use cases return this view, and they must return exactly the same one.
 */
export function toTranscriptionView(state: TranscriptionState): TranscriptionView {
  return {
    id: state.id,
    status: state.status,
    placement: state.placement,
    model: state.model,
    language: state.language,
    mediaName: state.mediaOriginalName,
    mediaContentType: state.mediaContentType,
    mediaByteSize: state.mediaByteSize,
    requestedAt: state.requestedAt,
    completedAt: state.completedAt,
    failureReason: state.failureReason,
    segments: state.segments,
    speakers: state.speakers,
  };
}
