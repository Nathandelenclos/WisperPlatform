import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';

import type { Database } from '../../../shared/infrastructure/persistence/database';
import { transcriptions } from '../../../shared/infrastructure/persistence/schema';
import type { TranscriptionQueue } from '../../application/ports/transcription-queue';
import type { Claimant } from '../../application/ports/worker-identities';
import type { WhisperModel } from '../../domain/transcription-settings';

/**
 * Technical queue. It SELECTS, it decides nothing: no status transition, no incremented
 * attempt, no lease set here. The aggregate is what transitions, once the use case has loaded
 * it.
 */
export class DrizzleTranscriptionQueue implements TranscriptionQueue {
  constructor(private readonly db: Database) {}

  /**
   * Atomic reservation in ONE single round trip. The `for update skip locked` lock of the
   * subquery guarantees that two concurrent workers cannot be handed the same row: the second
   * one skips the locked row, its subquery returns nothing, its `update` touches no row, and
   * it gets `null`.
   *
   * A reservation is purely technical and expires on its own: a `reserved_at` older than
   * `reservationSeconds` becomes reservable again. That is what makes a requeued transcription
   * (expired lease, therefore at least `leaseSeconds` after the reservation) immediately
   * claimable, without any adapter having to clear the column.
   *
   * The claimant is translated into a selection condition, never into filtering after the
   * fact: what is not for it must not even be reserved, otherwise two workers block each other
   * on rows neither of them is allowed to take.
   */
  async reserveNextPending(p: {
    claimant: Claimant;
    workerId: string;
    models: readonly WhisperModel[];
    reservationSeconds: number;
    now: Date;
  }): Promise<string | null> {
    if (p.models.length === 0) return null;

    const reservableSince = new Date(p.now.getTime() - p.reservationSeconds * 1000);
    const scope =
      p.claimant.kind === 'service'
        ? sql`${transcriptions.placement} = 'service'`
        : sql`${transcriptions.placement} = 'owner'
            and ${transcriptions.ownerId} = ${p.claimant.ownerId}`;

    const reserved = await this.db.execute<{ id: string }>(sql`
      update ${transcriptions}
      set ${sql.identifier('reserved_at')} = ${p.now},
          ${sql.identifier('reserved_by')} = ${p.workerId}
      where ${transcriptions.id} = (
        select ${transcriptions.id}
        from ${transcriptions}
        where ${transcriptions.status} = 'pending'
          and ${inArray(transcriptions.model, [...p.models])}
          and ${scope}
          and (
            ${transcriptions.reservedAt} is null
            or ${transcriptions.reservedAt} <= ${reservableSince}
          )
        order by ${transcriptions.requestedAt} asc
        limit 1
        for update skip locked
      )
      returning ${transcriptions.id}
    `);

    return reserved.rows[0]?.id ?? null;
  }

  /** Lifts the reservation: the row becomes visible to the queue again immediately. */
  async clearReservation(transcriptionId: string): Promise<void> {
    await this.db
      .update(transcriptions)
      .set({ reservedAt: null, reservedBy: null })
      .where(eq(transcriptions.id, transcriptionId));
  }

  async findStalled(p: { now: Date; limit: number }): Promise<string[]> {
    const rows = await this.db
      .select({ id: transcriptions.id })
      .from(transcriptions)
      .where(
        and(
          eq(transcriptions.status, 'transcribing'),
          lte(transcriptions.leaseExpiresAt, p.now),
        ),
      )
      .orderBy(asc(transcriptions.leaseExpiresAt))
      .limit(p.limit);

    return rows.map((row) => row.id);
  }
}
