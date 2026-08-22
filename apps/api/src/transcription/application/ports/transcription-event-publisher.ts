import type { TranscriptionEvent } from '../../domain/events';

/** Diffusion des événements de domaine, appelée après un enregistrement réussi. */
export interface TranscriptionEventPublisher {
  publish(events: readonly TranscriptionEvent[]): Promise<void>;
}

export const TRANSCRIPTION_EVENT_PUBLISHER = Symbol('TranscriptionEventPublisher');

/**
 * Abonnement aux événements d'une transcription, consommé par l'interface (SSE).
 * Le cloisonnement par propriétaire fait partie du contrat : on ne s'abonne qu'à ses propres flux.
 * `subscribe` rend la fonction de désabonnement.
 */
export interface TranscriptionEventStream {
  subscribe(
    p: { transcriptionId: string; ownerId: string },
    listener: (event: TranscriptionEvent) => void,
  ): () => void;
}

export const TRANSCRIPTION_EVENT_STREAM = Symbol('TranscriptionEventStream');
