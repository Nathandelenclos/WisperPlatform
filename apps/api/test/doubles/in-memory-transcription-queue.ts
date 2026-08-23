import type { TranscriptionQueue } from '../../src/transcription/application/ports/transcription-queue';
import type { Claimant } from '../../src/transcription/application/ports/worker-identities';
import type { WhisperModel } from '../../src/transcription/domain/transcription-settings';

import type { InMemoryTranscriptionStore } from './in-memory-transcription-store';

/**
 * Replica of the real queue's behaviour (`for update skip locked` + reservation columns): a
 * pending transcription never goes out twice in a row to two workers, only the served models are
 * offered, an abandoned reservation becomes available again on its own, and the claimant only
 * sees what is placed for it.
 */
export class InMemoryTranscriptionQueue implements TranscriptionQueue {
  constructor(private readonly store: InMemoryTranscriptionStore) {}

  async reserveNextPending(p: {
    claimant: Claimant;
    workerId: string;
    models: readonly WhisperModel[];
    reservationSeconds: number;
    now: Date;
  }): Promise<string | null> {
    const reservationFloor = p.now.getTime() - p.reservationSeconds * 1_000;
    const next = this.store
      .rows()
      .filter(
        (row) =>
          row.state.status === 'pending' &&
          p.models.includes(row.state.model) &&
          // Same partitioning as the real adapter's SQL condition.
          (p.claimant.kind === 'service'
            ? row.state.placement === 'service'
            : row.state.placement === 'owner' && row.state.ownerId === p.claimant.ownerId) &&
          (row.reservedAt === null || row.reservedAt.getTime() <= reservationFloor),
      )
      .sort((left, right) => left.state.requestedAt.getTime() - right.state.requestedAt.getTime())
      .at(0);

    if (next === undefined) {
      return null;
    }
    next.reservedAt = new Date(p.now);
    next.reservedBy = p.workerId;
    return next.state.id;
  }

  async clearReservation(transcriptionId: string): Promise<void> {
    const row = this.store.rows().find((candidate) => candidate.state.id === transcriptionId);
    if (row !== undefined) {
      row.reservedAt = null;
      row.reservedBy = null;
    }
  }

  async findStalled(p: { now: Date; limit: number }): Promise<string[]> {
    return this.store
      .rows()
      .filter(
        (row) =>
          row.state.status === 'transcribing' &&
          row.state.leaseExpiresAt !== null &&
          row.state.leaseExpiresAt.getTime() <= p.now.getTime(),
      )
      .sort(
        (left, right) =>
          (left.state.leaseExpiresAt?.getTime() ?? 0) - (right.state.leaseExpiresAt?.getTime() ?? 0),
      )
      .slice(0, p.limit)
      .map((row) => row.state.id);
  }
}
