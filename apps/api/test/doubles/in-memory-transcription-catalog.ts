import type {
  TranscriptionCatalog,
  TranscriptionSummary,
} from '../../src/transcription/application/ports/transcription-catalog';

import type { InMemoryTranscriptionStore } from './in-memory-transcription-store';

export class InMemoryTranscriptionCatalog implements TranscriptionCatalog {
  constructor(private readonly store: InMemoryTranscriptionStore) {}

  async listOwnedBy(ownerId: string): Promise<TranscriptionSummary[]> {
    return this.store
      .states()
      .filter((state) => state.ownerId === ownerId)
      .sort((left, right) => right.requestedAt.getTime() - left.requestedAt.getTime())
      .map((state) => ({
        id: state.id,
        status: state.status,
        placement: state.placement,
        model: state.model,
        language: state.language,
        mediaName: state.mediaOriginalName,
        mediaByteSize: state.mediaByteSize,
        segmentCount: state.segments.length,
        // Même définition que le `coalesce(max(end_ms), 0)` de l'adaptateur réel.
        durationMs: state.segments.reduce((furthest, segment) => Math.max(furthest, segment.endMs), 0),
        requestedAt: state.requestedAt,
        completedAt: state.completedAt,
        failureReason: state.failureReason,
      }));
  }
}
