import { asc, eq } from 'drizzle-orm';

import type { Database } from '../../../shared/infrastructure/persistence/database';
import {
  transcriptionSegments,
  transcriptions,
} from '../../../shared/infrastructure/persistence/schema';
import type { TranscriptionRepository } from '../../application/ports/transcription-repository';
import type { SegmentState } from '../../domain/segment';
import {
  Transcription,
  type TranscriptionState,
  type TranscriptionStatus,
} from '../../domain/transcription';
import type { WhisperModel } from '../../domain/transcription-settings';

type TranscriptionRow = typeof transcriptions.$inferSelect;
type SegmentRow = typeof transcriptionSegments.$inferSelect;

/**
 * Traduction état de l'aggregate ↔ colonnes. Ce mapping vit ici et nulle part ailleurs :
 * le domaine ignore qu'une base existe.
 */
export class DrizzleTranscriptionRepository implements TranscriptionRepository {
  constructor(private readonly db: Database) {}

  /**
   * Écrit l'aggregate ENTIER en une seule transaction : la ligne d'en-tête et le jeu complet
   * de segments. Les segments sont remplacés plutôt que fusionnés, parce que l'aggregate est
   * la seule autorité sur leur contenu ; la déduplication d'un lot rejoué est déjà portée par
   * `lastAppliedBatchSequence`, persisté dans la même transaction — d'où l'idempotence.
   */
  async save(transcription: Transcription): Promise<void> {
    const state = transcription.state();
    const row = {
      id: state.id,
      ownerId: state.ownerId,
      status: state.status,
      model: state.model,
      language: state.language,
      mediaStorageKey: state.mediaStorageKey,
      mediaOriginalName: state.mediaOriginalName,
      mediaContentType: state.mediaContentType,
      mediaByteSize: state.mediaByteSize,
      attempts: state.attempts,
      currentRunId: state.currentRunId,
      claimedBy: state.claimedBy,
      leaseExpiresAt: state.leaseExpiresAt,
      lastAppliedBatchSequence: state.lastAppliedBatchSequence,
      failureReason: state.failureReason,
      requestedAt: state.requestedAt,
      completedAt: state.completedAt,
    };

    await this.db.transaction(async (tx) => {
      await tx
        .insert(transcriptions)
        .values(row)
        .onConflictDoUpdate({
          target: transcriptions.id,
          // `reservedAt` / `reservedBy` sont volontairement absents : ce sont des colonnes de
          // file d'attente, invisibles de l'aggregate, qu'une sauvegarde ne doit pas écraser.
          set: {
            status: row.status,
            model: row.model,
            language: row.language,
            mediaStorageKey: row.mediaStorageKey,
            mediaOriginalName: row.mediaOriginalName,
            mediaContentType: row.mediaContentType,
            mediaByteSize: row.mediaByteSize,
            attempts: row.attempts,
            currentRunId: row.currentRunId,
            claimedBy: row.claimedBy,
            leaseExpiresAt: row.leaseExpiresAt,
            lastAppliedBatchSequence: row.lastAppliedBatchSequence,
            failureReason: row.failureReason,
            completedAt: row.completedAt,
          },
        });

      await tx
        .delete(transcriptionSegments)
        .where(eq(transcriptionSegments.transcriptionId, state.id));

      if (state.segments.length > 0) {
        await tx.insert(transcriptionSegments).values(
          state.segments.map((segment) => ({
            transcriptionId: state.id,
            ordinal: segment.ordinal,
            startMs: segment.startMs,
            endMs: segment.endMs,
            text: segment.text,
            corrected: segment.corrected,
          })),
        );
      }
    });
  }

  async findById(id: string): Promise<Transcription | null> {
    const [row] = await this.db.select().from(transcriptions).where(eq(transcriptions.id, id));
    if (!row) return null;

    const segmentRows = await this.db
      .select()
      .from(transcriptionSegments)
      .where(eq(transcriptionSegments.transcriptionId, id))
      .orderBy(asc(transcriptionSegments.ordinal));

    return Transcription.restore(toState(row, segmentRows));
  }
}

function toState(row: TranscriptionRow, segmentRows: readonly SegmentRow[]): TranscriptionState {
  return {
    id: row.id,
    ownerId: row.ownerId,
    // La base garde des `text` : l'aggregate revalide ses propres unions à la reconstitution.
    status: row.status as TranscriptionStatus,
    model: row.model as WhisperModel,
    language: row.language,
    mediaStorageKey: row.mediaStorageKey,
    mediaOriginalName: row.mediaOriginalName,
    mediaContentType: row.mediaContentType,
    // `bigint` en `mode: 'number'` : exact jusqu'à ~8 PiO, six ordres de grandeur au-dessus
    // de la borne d'acceptation d'un média (MEDIA_MAX_BYTES, 2 GiO par défaut).
    mediaByteSize: row.mediaByteSize,
    attempts: row.attempts,
    currentRunId: row.currentRunId,
    claimedBy: row.claimedBy,
    leaseExpiresAt: row.leaseExpiresAt,
    lastAppliedBatchSequence: row.lastAppliedBatchSequence,
    failureReason: row.failureReason,
    requestedAt: row.requestedAt,
    completedAt: row.completedAt,
    segments: segmentRows.map(
      (segment): SegmentState => ({
        ordinal: segment.ordinal,
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: segment.text,
        corrected: segment.corrected,
      }),
    ),
  };
}
