import type { Placement } from './placement';
import type { SegmentState } from './segment';
import type { SpeakerState } from './speaker';

/**
 * Domain events produced by the `Transcription` aggregate. Immutable, free of PII:
 * they are broadcast as they are to the owner's browser over SSE.
 */
export type TranscriptionEvent =
  | { name: 'transcription.requested'; transcriptionId: string; ownerId: string; occurredAt: Date }
  | {
      name: 'transcription.started';
      transcriptionId: string;
      ownerId: string;
      runId: string;
      occurredAt: Date;
    }
  | {
      name: 'transcription.segments-appended';
      transcriptionId: string;
      ownerId: string;
      segments: SegmentState[];
      occurredAt: Date;
    }
  | { name: 'transcription.completed'; transcriptionId: string; ownerId: string; occurredAt: Date }
  | {
      name: 'transcription.failed';
      transcriptionId: string;
      ownerId: string;
      reason: string;
      occurredAt: Date;
    }
  | { name: 'transcription.requeued'; transcriptionId: string; ownerId: string; occurredAt: Date }
  | {
      name: 'transcription.segment-corrected';
      transcriptionId: string;
      ownerId: string;
      ordinal: number;
      occurredAt: Date;
    }
  /**
   * The owner chose where their request would be computed. No worker has touched it yet:
   * this is a routing decision, not work in progress being moved.
   */
  | {
      name: 'transcription.placement-changed';
      transcriptionId: string;
      ownerId: string;
      placement: Placement;
      occurredAt: Date;
    }
  /**
   * Diarization has spoken: the speakers discovered, and every segment with the speaker it
   * now carries — one assignment reshuffles the whole transcription.
   */
  | {
      name: 'transcription.speakers-assigned';
      transcriptionId: string;
      ownerId: string;
      speakers: SpeakerState[];
      segments: SegmentState[];
      occurredAt: Date;
    }
  /** `speakerName` and not `name`: `name` already denotes the type of the event. */
  | {
      name: 'transcription.speaker-renamed';
      transcriptionId: string;
      ownerId: string;
      index: number;
      speakerName: string;
      occurredAt: Date;
    };

export type TranscriptionEventName = TranscriptionEvent['name'];
