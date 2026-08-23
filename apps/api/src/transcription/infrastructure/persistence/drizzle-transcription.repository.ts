import { and, asc, eq } from 'drizzle-orm';

import type { Database } from '../../../shared/infrastructure/persistence/database';
import {
  transcriptionSegments,
  transcriptionSpeakers,
  transcriptions,
} from '../../../shared/infrastructure/persistence/schema';
import { ConcurrentTranscriptionWriteError } from '../../application/errors';
import type { TranscriptionRepository } from '../../application/ports/transcription-repository';
import type { Placement } from '../../domain/placement';
import type { SegmentState } from '../../domain/segment';
import type { SpeakerState } from '../../domain/speaker';
import {
  Transcription,
  type TranscriptionState,
  type TranscriptionStatus,
} from '../../domain/transcription';
import type { WhisperModel } from '../../domain/transcription-settings';

type TranscriptionRow = typeof transcriptions.$inferSelect;
type SegmentRow = typeof transcriptionSegments.$inferSelect;
type SpeakerRow = typeof transcriptionSpeakers.$inferSelect;

/**
 * Translation between aggregate state and columns. This mapping lives here and nowhere else:
 * the domain has no idea a database exists.
 */
export class DrizzleTranscriptionRepository implements TranscriptionRepository {
  /**
   * Version read for each loaded aggregate. The counter is a persistence concern: the domain
   * does not have to carry it, and a `WeakMap` releases it along with the aggregate.
   */
  private readonly loadedVersions = new WeakMap<Transcription, number>();

  constructor(private readonly db: Database) {}

  /**
   * Writes the WHOLE aggregate in a single transaction: the header row, the complete set of
   * segments and the complete set of speakers. They are replaced rather than merged, because
   * the aggregate is the only authority on their content — deduplication of a replayed batch
   * is already carried by `lastAppliedBatchSequence`, persisted in the same transaction, hence
   * the idempotence.
   */
  async save(transcription: Transcription): Promise<void> {
    const state = transcription.state();
    const row = {
      id: state.id,
      ownerId: state.ownerId,
      status: state.status,
      placement: state.placement,
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

    const expectedVersion = this.loadedVersions.get(transcription) ?? null;

    await this.db.transaction(async (tx) => {
      if (expectedVersion === null) {
        // Aggregate never loaded: this is a creation. A key collision means another writer
        // got there first.
        const inserted = await tx
          .insert(transcriptions)
          .values({ ...row, version: 1 })
          .onConflictDoNothing({ target: transcriptions.id })
          .returning({ id: transcriptions.id });
        if (inserted.length === 0) {
          throw new ConcurrentTranscriptionWriteError(state.id);
        }
        this.loadedVersions.set(transcription, 1);
      } else {
        // Optimistic lock: the write only lands if nobody touched the row since it was read.
        // Without it, a user correction and a batch of segments arriving at the same time
        // overwrite each other in silence.
        const updated = await tx
          .update(transcriptions)
          .set({
            status: row.status,
            placement: row.placement,
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
            version: expectedVersion + 1,
          })
          // `reservedAt` / `reservedBy` are deliberately absent: they are queue columns,
          // invisible to the aggregate, that a save must not overwrite.
          .where(
            and(eq(transcriptions.id, state.id), eq(transcriptions.version, expectedVersion)),
          )
          .returning({ id: transcriptions.id });
        if (updated.length === 0) {
          throw new ConcurrentTranscriptionWriteError(state.id);
        }
        this.loadedVersions.set(transcription, expectedVersion + 1);
      }

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
            speakerIndex: segment.speakerIndex,
          })),
        );
      }

      await tx
        .delete(transcriptionSpeakers)
        .where(eq(transcriptionSpeakers.transcriptionId, state.id));

      if (state.speakers.length > 0) {
        await tx.insert(transcriptionSpeakers).values(
          state.speakers.map((speaker) => ({
            transcriptionId: state.id,
            index: speaker.index,
            name: speaker.name,
          })),
        );
      }
    });
  }

  /**
   * Three tables for one aggregate: reading is transactional just like writing.
   * Three independent `select`s could return a torn aggregate — a header from one version,
   * segments and speakers from another — if a write committed between two of them. The
   * optimistic lock caught that case on a write path; a plain read, on the other hand, served
   * the mixed view to the owner without detecting anything.
   */
  async findById(id: string): Promise<Transcription | null> {
    const loaded = await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(transcriptions).where(eq(transcriptions.id, id));
      if (!row) return null;

      const segmentRows = await tx
        .select()
        .from(transcriptionSegments)
        .where(eq(transcriptionSegments.transcriptionId, id))
        .orderBy(asc(transcriptionSegments.ordinal));

      const speakerRows = await tx
        .select()
        .from(transcriptionSpeakers)
        .where(eq(transcriptionSpeakers.transcriptionId, id))
        .orderBy(asc(transcriptionSpeakers.index));

      return { row, transcription: Transcription.restore(toState(row, segmentRows, speakerRows)) };
    });
    if (loaded === null) return null;

    this.loadedVersions.set(loaded.transcription, loaded.row.version);
    return loaded.transcription;
  }
}

function toState(
  row: TranscriptionRow,
  segmentRows: readonly SegmentRow[],
  speakerRows: readonly SpeakerRow[],
): TranscriptionState {
  return {
    id: row.id,
    ownerId: row.ownerId,
    // The database keeps `text`: the aggregate revalidates its own unions when restoring.
    status: row.status as TranscriptionStatus,
    placement: row.placement as Placement,
    model: row.model as WhisperModel,
    language: row.language,
    mediaStorageKey: row.mediaStorageKey,
    mediaOriginalName: row.mediaOriginalName,
    mediaContentType: row.mediaContentType,
    // `bigint` in `mode: 'number'`: exact up to ~8 PiB, six orders of magnitude above the
    // acceptance bound for a media file (MEDIA_MAX_BYTES, 2 GiB by default).
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
        speakerIndex: segment.speakerIndex,
      }),
    ),
    speakers: speakerRows.map(
      (speaker): SpeakerState => ({ index: speaker.index, name: speaker.name }),
    ),
  };
}
