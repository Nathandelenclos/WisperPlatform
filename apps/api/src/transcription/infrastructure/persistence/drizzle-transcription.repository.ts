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
 * Traduction état de l'aggregate ↔ colonnes. Ce mapping vit ici et nulle part ailleurs :
 * le domaine ignore qu'une base existe.
 */
export class DrizzleTranscriptionRepository implements TranscriptionRepository {
  /**
   * Version lue pour chaque aggregate chargé. Le compteur est une préoccupation de
   * persistance : le domaine n'a pas à le porter, et une `WeakMap` le libère avec l'aggregate.
   */
  private readonly loadedVersions = new WeakMap<Transcription, number>();

  constructor(private readonly db: Database) {}

  /**
   * Écrit l'aggregate ENTIER en une seule transaction : la ligne d'en-tête, le jeu complet de
   * segments et celui des locuteurs. Ils sont remplacés plutôt que fusionnés, parce que
   * l'aggregate est la seule autorité sur leur contenu ; la déduplication d'un lot rejoué est
   * déjà portée par `lastAppliedBatchSequence`, persisté dans la même transaction — d'où
   * l'idempotence.
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
        // Aggregate jamais chargé : c'est une création. Une collision de clé signifie qu'un
        // autre écrivain l'a devancé.
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
        // Verrou optimiste : l'écriture n'aboutit que si personne n'a touché la ligne depuis
        // la lecture. Sans lui, une correction utilisateur et un lot de segments arrivés en
        // même temps s'écrasent l'un l'autre en silence.
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
          // `reservedAt` / `reservedBy` sont volontairement absents : ce sont des colonnes de
          // file d'attente, invisibles de l'aggregate, qu'une sauvegarde ne doit pas écraser.
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
   * Trois tables pour un aggregate : la lecture est transactionnelle comme l'écriture.
   * Trois `select` indépendants pouvaient rendre un aggregate déchiré — un en-tête d'une
   * version, des segments et des locuteurs d'une autre — si une écriture commitait entre
   * deux d'entre eux. Le verrou optimiste rattrapait le cas sur un chemin d'écriture ;
   * une lecture seule, elle, servait la vue mélangée au propriétaire sans rien détecter.
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
    // La base garde des `text` : l'aggregate revalide ses propres unions à la reconstitution.
    status: row.status as TranscriptionStatus,
    placement: row.placement as Placement,
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
        speakerIndex: segment.speakerIndex,
      }),
    ),
    speakers: speakerRows.map(
      (speaker): SpeakerState => ({ index: speaker.index, name: speaker.name }),
    ),
  };
}
