import type { TranscriptionEvent } from '../../domain/events';

/** Broadcast of domain events, called after a successful save. */
export interface TranscriptionEventPublisher {
  publish(events: readonly TranscriptionEvent[]): Promise<void>;
}

export const TRANSCRIPTION_EVENT_PUBLISHER = Symbol('TranscriptionEventPublisher');

/**
 * Subscription to a transcription's events, consumed by the interface layer (SSE).
 * Partitioning by owner is part of the contract: one only subscribes to one's own streams.
 * `subscribe` returns the unsubscribe function.
 */
export interface TranscriptionEventStream {
  subscribe(
    p: { transcriptionId: string; ownerId: string },
    listener: (event: TranscriptionEvent) => void,
  ): () => void;
}

export const TRANSCRIPTION_EVENT_STREAM = Symbol('TranscriptionEventStream');
