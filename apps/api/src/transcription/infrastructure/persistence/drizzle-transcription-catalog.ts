import { desc, eq, sql } from 'drizzle-orm';

import type { Database } from '../../../shared/infrastructure/persistence/database';
import {
  transcriptionSegments,
  transcriptions,
} from '../../../shared/infrastructure/persistence/schema';
import type {
  TranscriptionCatalog,
  TranscriptionSummary,
} from '../../application/ports/transcription-catalog';
import type { Placement } from '../../domain/placement';
import type { TranscriptionStatus } from '../../domain/transcription';
import type { WhisperModel } from '../../domain/transcription-settings';

/**
 * Modèle de lecture : projection dédiée à l'affichage d'une liste, calculée par la base.
 * On ne reconstitue aucun aggregate ici — lire une liste ne doit pas charger N jeux de segments.
 */
export class DrizzleTranscriptionCatalog implements TranscriptionCatalog {
  constructor(private readonly db: Database) {}

  async listOwnedBy(ownerId: string): Promise<TranscriptionSummary[]> {
    const rows = await this.db
      .select({
        id: transcriptions.id,
        status: transcriptions.status,
        placement: transcriptions.placement,
        model: transcriptions.model,
        language: transcriptions.language,
        mediaName: transcriptions.mediaOriginalName,
        mediaByteSize: transcriptions.mediaByteSize,
        requestedAt: transcriptions.requestedAt,
        completedAt: transcriptions.completedAt,
        failureReason: transcriptions.failureReason,
        segmentCount: sql<number>`count(${transcriptionSegments.ordinal})::int`,
        // Durée du transcrit = fin du dernier segment ; 0 quand il n'y a pas de parole.
        durationMs: sql<number>`coalesce(max(${transcriptionSegments.endMs}), 0)::int`,
      })
      .from(transcriptions)
      .leftJoin(
        transcriptionSegments,
        eq(transcriptionSegments.transcriptionId, transcriptions.id),
      )
      .where(eq(transcriptions.ownerId, ownerId))
      .groupBy(transcriptions.id)
      .orderBy(desc(transcriptions.requestedAt));

    return rows.map((row) => ({
      id: row.id,
      status: row.status as TranscriptionStatus,
      placement: row.placement as Placement,
      model: row.model as WhisperModel,
      language: row.language,
      mediaName: row.mediaName,
      mediaByteSize: row.mediaByteSize,
      segmentCount: row.segmentCount,
      durationMs: row.durationMs,
      requestedAt: row.requestedAt,
      completedAt: row.completedAt,
      failureReason: row.failureReason,
    }));
  }
}
