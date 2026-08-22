import type { SegmentState } from './segment';

/**
 * Événements de domaine produits par l'aggregate `Transcription`. Immuables, sans PII :
 * ils sont diffusés tels quels au navigateur du propriétaire via SSE.
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
    };

export type TranscriptionEventName = TranscriptionEvent['name'];
