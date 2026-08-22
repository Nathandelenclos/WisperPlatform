import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';

import type { Database } from '../../../shared/infrastructure/persistence/database';
import { transcriptions } from '../../../shared/infrastructure/persistence/schema';
import type { TranscriptionQueue } from '../../application/ports/transcription-queue';
import type { WhisperModel } from '../../domain/transcription-settings';

/**
 * File d'attente technique. Elle SÉLECTIONNE, elle ne décide rien : aucune transition de
 * statut, aucune tentative incrémentée, aucun bail posé ici. C'est l'aggregate qui transitionne
 * une fois chargé par le use case.
 */
export class DrizzleTranscriptionQueue implements TranscriptionQueue {
  constructor(private readonly db: Database) {}

  /**
   * Réservation atomique en UN seul aller-retour. Le verrou `for update skip locked` de la
   * sous-requête garantit que deux workers concurrents ne peuvent pas se voir attribuer la même
   * ligne : le second saute la ligne verrouillée, sa sous-requête ne rend rien, son `update`
   * ne touche aucune ligne, et il obtient `null`.
   *
   * Une réservation est purement technique et expire seule : `reserved_at` plus vieux que
   * `reservationSeconds` redevient réservable. C'est ce qui rend une transcription remise en
   * file (bail expiré, donc au moins `leaseSeconds` après la réservation) immédiatement
   * réclamable, sans qu'aucun adaptateur ait à effacer la colonne.
   */
  async reserveNextPending(p: {
    workerId: string;
    models: readonly WhisperModel[];
    reservationSeconds: number;
    now: Date;
  }): Promise<string | null> {
    if (p.models.length === 0) return null;

    const reservableSince = new Date(p.now.getTime() - p.reservationSeconds * 1000);

    const reserved = await this.db.execute<{ id: string }>(sql`
      update ${transcriptions}
      set ${sql.identifier('reserved_at')} = ${p.now},
          ${sql.identifier('reserved_by')} = ${p.workerId}
      where ${transcriptions.id} = (
        select ${transcriptions.id}
        from ${transcriptions}
        where ${transcriptions.status} = 'pending'
          and ${inArray(transcriptions.model, [...p.models])}
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
