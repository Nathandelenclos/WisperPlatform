import type { Placement } from './placement';
import type { SegmentState } from './segment';
import type { SpeakerState } from './speaker';

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
    }
  /**
   * Le propriétaire a choisi où sa demande serait calculée. Aucun worker n'y a encore touché :
   * c'est un aiguillage, pas un déplacement de travail en cours.
   */
  | {
      name: 'transcription.placement-changed';
      transcriptionId: string;
      ownerId: string;
      placement: Placement;
      occurredAt: Date;
    }
  /**
   * La diarisation a parlé : les locuteurs découverts, et tous les segments avec le locuteur
   * qu'ils portent désormais — une attribution rebat les cartes de la transcription entière.
   */
  | {
      name: 'transcription.speakers-assigned';
      transcriptionId: string;
      ownerId: string;
      speakers: SpeakerState[];
      segments: SegmentState[];
      occurredAt: Date;
    }
  /** `speakerName` et non `name` : `name` désigne déjà le type de l'événement. */
  | {
      name: 'transcription.speaker-renamed';
      transcriptionId: string;
      ownerId: string;
      index: number;
      speakerName: string;
      occurredAt: Date;
    };

export type TranscriptionEventName = TranscriptionEvent['name'];
