import {
  IllegalTranscriptionStateError,
  OutOfOrderBatchError,
  OverlappingSegmentsError,
  SegmentNotFoundError,
  StaleRunError,
  TranscriptionNotCorrectableError,
} from './errors';
import type { TranscriptionEvent } from './events';
import { MediaAsset } from './media-asset';
import { Segment, type SegmentState } from './segment';
import { renderSubtitles, type SubtitleFormat } from './subtitle-document';
import { TimeRange } from './time-range';
import { TranscriptionSettings, type WhisperModel } from './transcription-settings';

export type TranscriptionStatus = 'pending' | 'transcribing' | 'completed' | 'failed';

/** Forme sérialisable de l'aggregate : le repository écrit et relit exactement ceci. */
export type TranscriptionState = {
  id: string;
  ownerId: string;
  status: TranscriptionStatus;
  model: WhisperModel;
  language: string;
  mediaStorageKey: string;
  mediaOriginalName: string;
  mediaContentType: string;
  mediaByteSize: number;
  attempts: number;
  currentRunId: string | null;
  claimedBy: string | null;
  leaseExpiresAt: Date | null;
  lastAppliedBatchSequence: number;
  failureReason: string | null;
  requestedAt: Date;
  completedAt: Date | null;
  segments: SegmentState[];
};

/** Raison figée d'un échec provoqué par l'abandon d'un worker. */
const LEASE_EXPIRED_REASON = 'lease expired';

/**
 * Aggregate root du contexte `transcription`. Il porte le cycle de vie d'une demande
 * (attente → transcription en cours → achevée ou échouée), la propriété des segments et
 * l'idempotence du flux de segments envoyé par un worker.
 */
export class Transcription {
  private status: TranscriptionStatus;
  private attempts: number;
  private currentRunId: string | null;
  private claimedBy: string | null;
  private leaseExpiresAt: Date | null;
  private lastAppliedBatchSequence: number;
  private failureReason: string | null;
  private completedAt: Date | null;
  private segmentList: Segment[];
  private readonly events: TranscriptionEvent[] = [];

  private constructor(
    readonly id: string,
    readonly ownerId: string,
    readonly media: MediaAsset,
    readonly settings: TranscriptionSettings,
    readonly requestedAt: Date,
    state: {
      status: TranscriptionStatus;
      attempts: number;
      currentRunId: string | null;
      claimedBy: string | null;
      leaseExpiresAt: Date | null;
      lastAppliedBatchSequence: number;
      failureReason: string | null;
      completedAt: Date | null;
      segments: Segment[];
    },
  ) {
    this.status = state.status;
    this.attempts = state.attempts;
    this.currentRunId = state.currentRunId;
    this.claimedBy = state.claimedBy;
    this.leaseExpiresAt = state.leaseExpiresAt;
    this.lastAppliedBatchSequence = state.lastAppliedBatchSequence;
    this.failureReason = state.failureReason;
    this.completedAt = state.completedAt;
    this.segmentList = state.segments;
  }

  static request(p: {
    id: string;
    ownerId: string;
    media: MediaAsset;
    settings: TranscriptionSettings;
    requestedAt: Date;
  }): Transcription {
    const transcription = new Transcription(
      p.id,
      p.ownerId,
      p.media,
      p.settings,
      p.requestedAt,
      {
        status: 'pending',
        attempts: 0,
        currentRunId: null,
        claimedBy: null,
        leaseExpiresAt: null,
        lastAppliedBatchSequence: 0,
        failureReason: null,
        completedAt: null,
        segments: [],
      },
    );
    transcription.events.push({
      name: 'transcription.requested',
      transcriptionId: p.id,
      ownerId: p.ownerId,
      occurredAt: p.requestedAt,
    });
    return transcription;
  }

  static restore(state: TranscriptionState): Transcription {
    return new Transcription(
      state.id,
      state.ownerId,
      MediaAsset.stored({
        storageKey: state.mediaStorageKey,
        originalName: state.mediaOriginalName,
        contentType: state.mediaContentType,
        byteSize: state.mediaByteSize,
      }),
      TranscriptionSettings.of(state.model, state.language),
      state.requestedAt,
      {
        status: state.status,
        attempts: state.attempts,
        currentRunId: state.currentRunId,
        claimedBy: state.claimedBy,
        leaseExpiresAt: state.leaseExpiresAt,
        lastAppliedBatchSequence: state.lastAppliedBatchSequence,
        failureReason: state.failureReason,
        completedAt: state.completedAt,
        segments: state.segments.map((segment) => Segment.restore(segment)),
      },
    );
  }

  get segments(): readonly Segment[] {
    return this.segmentList;
  }

  /** Une nouvelle tentative démarre : les segments de la tentative précédente sont abandonnés. */
  startTranscribing(p: { runId: string; workerId: string; leaseExpiresAt: Date; at: Date }): void {
    if (this.status !== 'pending') {
      throw new IllegalTranscriptionStateError(
        `une transcription au statut ${this.status} ne peut pas démarrer`,
      );
    }
    this.status = 'transcribing';
    this.attempts += 1;
    this.currentRunId = p.runId;
    this.claimedBy = p.workerId;
    this.leaseExpiresAt = p.leaseExpiresAt;
    this.lastAppliedBatchSequence = 0;
    this.failureReason = null;
    this.completedAt = null;
    this.segmentList = [];
    this.events.push({
      name: 'transcription.started',
      transcriptionId: this.id,
      ownerId: this.ownerId,
      runId: p.runId,
      occurredAt: p.at,
    });
  }

  /**
   * Ajoute un lot de segments produit par le run courant. Le rejeu d'un lot déjà appliqué est
   * ignoré en silence : c'est ce qui rend le POST du worker sûr après un timeout réseau.
   */
  appendTranscribedSegments(p: {
    runId: string;
    batchSequence: number;
    segments: { range: TimeRange; text: string }[];
  }): void {
    this.assertRunIsInProgress(p.runId, 'ajouter des segments');
    if (p.batchSequence <= this.lastAppliedBatchSequence) {
      return;
    }
    if (p.batchSequence !== this.lastAppliedBatchSequence + 1) {
      throw new OutOfOrderBatchError(
        `lot ${p.batchSequence} inattendu : le lot ${this.lastAppliedBatchSequence + 1} manque`,
      );
    }

    let previous = this.segmentList.at(-1)?.range ?? null;
    const appended: Segment[] = [];
    for (const incoming of p.segments) {
      if (previous !== null && !previous.precedesOrTouches(incoming.range)) {
        throw new OverlappingSegmentsError(
          'les segments d\'un lot doivent être ordonnés et sans chevauchement',
        );
      }
      appended.push(
        Segment.transcribed(
          this.segmentList.length + appended.length + 1,
          incoming.range,
          incoming.text,
        ),
      );
      previous = incoming.range;
    }

    this.lastAppliedBatchSequence = p.batchSequence;
    if (appended.length === 0) {
      // Lot vidé en amont (segments sans parole) : la séquence avance, il n'y a rien à annoncer.
      return;
    }
    this.segmentList = [...this.segmentList, ...appended];
    this.events.push({
      name: 'transcription.segments-appended',
      transcriptionId: this.id,
      ownerId: this.ownerId,
      segments: appended.map((segment) => segment.state()),
      occurredAt: new Date(),
    });
  }

  /** Le worker donne signe de vie : le bail est repoussé, sans événement métier. */
  renewLease(p: { runId: string; leaseExpiresAt: Date }): void {
    this.assertRunIsInProgress(p.runId, 'renouveler le bail');
    this.leaseExpiresAt = p.leaseExpiresAt;
  }

  /** Une transcription sans aucun segment est légale : le média peut ne contenir aucune parole. */
  complete(p: { runId: string; at: Date }): void {
    this.assertRunIsInProgress(p.runId, 'achever la transcription');
    this.status = 'completed';
    this.completedAt = p.at;
    this.leaseExpiresAt = null;
    this.failureReason = null;
    this.events.push({
      name: 'transcription.completed',
      transcriptionId: this.id,
      ownerId: this.ownerId,
      occurredAt: p.at,
    });
  }

  fail(p: { runId: string; reason: string; at: Date }): void {
    this.assertRunIsInProgress(p.runId, 'déclarer un échec');
    this.markFailed(p.reason, p.at);
  }

  /**
   * Le bail d'un worker disparu est arrivé à terme : on remet la demande en file, sauf si
   * elle a déjà consommé toutes ses tentatives. Sans bail dépassé, l'appel ne fait rien :
   * la balayeuse peut travailler sur une lecture devenue obsolète.
   */
  requeueExpiredLease(p: { at: Date; maxAttempts: number }): void {
    if (this.status !== 'transcribing' || this.leaseExpiresAt === null) {
      return;
    }
    if (this.leaseExpiresAt.getTime() > p.at.getTime()) {
      return;
    }
    if (this.attempts >= p.maxAttempts) {
      this.markFailed(LEASE_EXPIRED_REASON, p.at);
      return;
    }
    this.status = 'pending';
    this.currentRunId = null;
    this.claimedBy = null;
    this.leaseExpiresAt = null;
    this.events.push({
      name: 'transcription.requeued',
      transcriptionId: this.id,
      ownerId: this.ownerId,
      occurredAt: p.at,
    });
  }

  correctSegment(p: { ordinal: number; text: string; at: Date }): void {
    if (this.status !== 'completed') {
      throw new TranscriptionNotCorrectableError(
        `une transcription au statut ${this.status} n'est pas corrigeable`,
      );
    }
    const index = this.segmentList.findIndex((segment) => segment.ordinal === p.ordinal);
    if (index === -1) {
      throw new SegmentNotFoundError(`aucun segment ne porte l'ordinal ${p.ordinal}`);
    }
    const corrected = [...this.segmentList];
    corrected[index] = this.segmentList[index].withCorrectedText(p.text);
    this.segmentList = corrected;
    this.events.push({
      name: 'transcription.segment-corrected',
      transcriptionId: this.id,
      ownerId: this.ownerId,
      ordinal: p.ordinal,
      occurredAt: p.at,
    });
  }

  render(format: SubtitleFormat): string {
    return renderSubtitles(this.segmentList, format);
  }

  /** Vide et rend les événements accumulés : à publier après un enregistrement réussi. */
  pullEvents(): TranscriptionEvent[] {
    return this.events.splice(0, this.events.length);
  }

  state(): TranscriptionState {
    return {
      id: this.id,
      ownerId: this.ownerId,
      status: this.status,
      model: this.settings.model,
      language: this.settings.language,
      mediaStorageKey: this.media.storageKey,
      mediaOriginalName: this.media.originalName,
      mediaContentType: this.media.contentType,
      mediaByteSize: this.media.byteSize,
      attempts: this.attempts,
      currentRunId: this.currentRunId,
      claimedBy: this.claimedBy,
      leaseExpiresAt: this.leaseExpiresAt,
      lastAppliedBatchSequence: this.lastAppliedBatchSequence,
      failureReason: this.failureReason,
      requestedAt: this.requestedAt,
      completedAt: this.completedAt,
      segments: this.segmentList.map((segment) => segment.state()),
    };
  }

  private markFailed(reason: string, at: Date): void {
    const trimmed = reason.trim();
    this.status = 'failed';
    this.failureReason = trimmed.length === 0 ? 'unspecified' : trimmed;
    this.leaseExpiresAt = null;
    this.events.push({
      name: 'transcription.failed',
      transcriptionId: this.id,
      ownerId: this.ownerId,
      reason: this.failureReason,
      occurredAt: at,
    });
  }

  /**
   * Seul le run en cours pilote la transcription : un run remplacé (bail expiré puis reprise)
   * n'a plus le droit d'écrire, et rien ne s'écrit hors de l'état `transcribing`.
   */
  private assertRunIsInProgress(runId: string, intent: string): void {
    if (this.status !== 'transcribing') {
      throw new IllegalTranscriptionStateError(
        `impossible de ${intent} : la transcription est au statut ${this.status}`,
      );
    }
    if (this.currentRunId !== runId) {
      throw new StaleRunError(`impossible de ${intent} : cette tentative a été remplacée`);
    }
  }
}
