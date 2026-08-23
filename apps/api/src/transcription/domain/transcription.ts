import {
  IllegalTranscriptionStateError,
  InvalidLeaseDurationError,
  OutOfOrderBatchError,
  OverlappingSegmentsError,
  SegmentNotFoundError,
  SpeakerNotFoundError,
  StaleRunError,
  TranscriptionNotCorrectableError,
} from './errors';
import type { TranscriptionEvent } from './events';
import { MediaAsset } from './media-asset';
import { DEFAULT_PLACEMENT, type Placement } from './placement';
import { Segment, type SegmentState } from './segment';
import { Speaker, SpeakerName, type SpeakerState } from './speaker';
import { distinctSpeakers, dominantSpeaker, type SpeakerTurn } from './speaker-turn';
import { renderSubtitles, type SubtitleFormat } from './subtitle-document';
import { TimeRange } from './time-range';
import { TranscriptionSettings, type WhisperModel } from './transcription-settings';

export type TranscriptionStatus = 'pending' | 'transcribing' | 'completed' | 'failed';

/** Serializable shape of the aggregate: the repository writes and reads back exactly this. */
export type TranscriptionState = {
  id: string;
  ownerId: string;
  status: TranscriptionStatus;
  /** Where the computation must run. See `Placement`: the default is `service`. */
  placement: Placement;
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
  speakers: SpeakerState[];
};

/** Fixed reason for a failure caused by a worker abandoning its run. */
const LEASE_EXPIRED_REASON = 'lease expired';

/**
 * Aggregate root of the `transcription` context. It carries the lifecycle of a request
 * (pending → transcribing → completed or failed), the ownership of the segments and the
 * idempotence of the segment stream a worker sends.
 */
export class Transcription {
  private status: TranscriptionStatus;
  private placementChoice: Placement;
  private attempts: number;
  private currentRunId: string | null;
  private claimedBy: string | null;
  private leaseExpiresAt: Date | null;
  private lastAppliedBatchSequence: number;
  private failureReason: string | null;
  private completedAt: Date | null;
  private segmentList: Segment[];
  private speakerList: Speaker[];
  /** Internal copy: the request instant is never the caller's own `Date`. */
  private readonly requestedAtInstant: Date;
  private readonly events: TranscriptionEvent[] = [];

  private constructor(
    readonly id: string,
    readonly ownerId: string,
    readonly media: MediaAsset,
    readonly settings: TranscriptionSettings,
    requestedAt: Date,
    state: {
      status: TranscriptionStatus;
      placement: Placement;
      attempts: number;
      currentRunId: string | null;
      claimedBy: string | null;
      leaseExpiresAt: Date | null;
      lastAppliedBatchSequence: number;
      failureReason: string | null;
      completedAt: Date | null;
      segments: Segment[];
      speakers: Speaker[];
    },
  ) {
    // Instants are copied on the way in just as they are on the way out: a caller that keeps
    // the `Date` it passed must not keep a hold on the aggregate's state.
    this.requestedAtInstant = new Date(requestedAt);
    this.status = state.status;
    this.placementChoice = state.placement;
    this.attempts = state.attempts;
    this.currentRunId = state.currentRunId;
    this.claimedBy = state.claimedBy;
    this.leaseExpiresAt = state.leaseExpiresAt === null ? null : new Date(state.leaseExpiresAt);
    this.lastAppliedBatchSequence = state.lastAppliedBatchSequence;
    this.failureReason = state.failureReason;
    this.completedAt = state.completedAt === null ? null : new Date(state.completedAt);
    this.segmentList = state.segments;
    this.speakerList = state.speakers;
  }

  static request(p: {
    id: string;
    ownerId: string;
    media: MediaAsset;
    settings: TranscriptionSettings;
    requestedAt: Date;
    /** Optional: without an explicit choice, the platform computes (see `DEFAULT_PLACEMENT`). */
    placement?: Placement;
  }): Transcription {
    const transcription = new Transcription(
      p.id,
      p.ownerId,
      p.media,
      p.settings,
      p.requestedAt,
      {
        status: 'pending',
        placement: p.placement ?? DEFAULT_PLACEMENT,
        attempts: 0,
        currentRunId: null,
        claimedBy: null,
        leaseExpiresAt: null,
        lastAppliedBatchSequence: 0,
        failureReason: null,
        completedAt: null,
        segments: [],
        speakers: [],
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
        placement: state.placement,
        attempts: state.attempts,
        currentRunId: state.currentRunId,
        claimedBy: state.claimedBy,
        leaseExpiresAt: state.leaseExpiresAt,
        lastAppliedBatchSequence: state.lastAppliedBatchSequence,
        failureReason: state.failureReason,
        completedAt: state.completedAt,
        segments: state.segments.map((segment) => Segment.restore(segment)),
        speakers: state.speakers.map((speaker) => Speaker.restore(speaker)),
      },
    );
  }

  get segments(): readonly Segment[] {
    return this.segmentList;
  }

  get speakers(): readonly Speaker[] {
    return this.speakerList;
  }

  /** Expiry of the current lease, copied: `null` outside a run in progress. */
  get leaseExpiry(): Date | null {
    return this.leaseExpiresAt === null ? null : new Date(this.leaseExpiresAt);
  }

  /**
   * A new attempt starts: the segments of the previous attempt are dropped, and with them the
   * speakers a diarization pass may have discovered.
   * The aggregate derives the lease expiry itself — "a lease is a bounded window that starts
   * now" is a rule of the context, not a caller's computation.
   */
  startTranscribing(p: { runId: string; workerId: string; leaseSeconds: number; at: Date }): void {
    if (this.status !== 'pending') {
      throw new IllegalTranscriptionStateError(
        `a transcription in status ${this.status} cannot start`,
      );
    }
    this.status = 'transcribing';
    this.attempts += 1;
    this.currentRunId = p.runId;
    this.claimedBy = p.workerId;
    this.leaseExpiresAt = Transcription.leaseWindow(p.at, p.leaseSeconds);
    this.lastAppliedBatchSequence = 0;
    this.failureReason = null;
    this.completedAt = null;
    this.segmentList = [];
    this.speakerList = [];
    this.events.push({
      name: 'transcription.started',
      transcriptionId: this.id,
      ownerId: this.ownerId,
      runId: p.runId,
      occurredAt: p.at,
    });
  }

  /**
   * Appends a batch of segments produced by the current run. Replaying an already applied batch
   * is silently ignored: that is what makes the worker's POST safe after a network timeout.
   */
  appendTranscribedSegments(p: {
    runId: string;
    batchSequence: number;
    segments: { range: TimeRange; text: string }[];
    at: Date;
  }): void {
    this.assertRunIsInProgress(p.runId, 'append segments');
    if (p.batchSequence <= this.lastAppliedBatchSequence) {
      return;
    }
    if (p.batchSequence !== this.lastAppliedBatchSequence + 1) {
      throw new OutOfOrderBatchError(
        `unexpected batch ${p.batchSequence}: missing batch ${this.lastAppliedBatchSequence + 1}`,
      );
    }

    let previous = this.segmentList.at(-1)?.range ?? null;
    const appended: Segment[] = [];
    for (const incoming of p.segments) {
      if (previous !== null && !previous.precedesOrTouches(incoming.range)) {
        throw new OverlappingSegmentsError(
          'the segments of a batch must be ordered and must not overlap',
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
      // Batch emptied upstream (segments with no speech): the sequence advances, and there is
      // nothing to announce.
      return;
    }
    this.segmentList = [...this.segmentList, ...appended];
    this.events.push({
      name: 'transcription.segments-appended',
      transcriptionId: this.id,
      ownerId: this.ownerId,
      segments: appended.map((segment) => segment.state()),
      occurredAt: p.at,
    });
  }

  /** The worker signals it is still alive: the lease is pushed back, with no domain event. */
  renewLease(p: { runId: string; leaseSeconds: number; at: Date }): void {
    this.assertRunIsInProgress(p.runId, 'renew the lease');
    this.leaseExpiresAt = Transcription.leaseWindow(p.at, p.leaseSeconds);
  }

  /** A transcription with no segments at all is legal: the media may contain no speech. */
  complete(p: { runId: string; at: Date }): void {
    this.assertRunIsInProgress(p.runId, 'complete the transcription');
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
    this.assertRunIsInProgress(p.runId, 'report a failure');
    this.markFailed(p.reason, p.at);
  }

  /**
   * The lease of a vanished worker has run out: the request is requeued, unless it has already
   * used up all of its attempts. With no lease past due, the call does nothing — the sweeper
   * may be working from a read that has since gone stale.
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

  /**
   * The worker hands the run back without having failed: it is shutting down (deployment,
   * scaling, machine stopping) and the request goes back into the queue right away, instead of
   * waiting for its lease to run out. This is not a failure: the run is abandoned, not broken,
   * and the segments of the dead attempt are thrown away by the next `startTranscribing`.
   *
   * The attempt stays counted: it did take place, and that is what stops a machine caught in a
   * restart loop from running the same transcription forever.
   */
  releaseRun(p: { runId: string; at: Date }): void {
    this.assertRunIsInProgress(p.runId, 'release the run');
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

  /**
   * The owner chooses where their request will be computed. As long as no worker has claimed it,
   * this is a simple routing switch — once started, moving it no longer makes sense: a run lives
   * on a machine, not on a choice, and bringing it back would mean throwing away its work.
   *
   * Asking for the placement already in force does nothing and does not throw: there is nothing
   * to change, so nothing to refuse, even on a completed transcription.
   */
  changePlacement(p: { placement: Placement; at: Date }): void {
    if (this.placementChoice === p.placement) {
      return;
    }
    if (this.status !== 'pending') {
      throw new IllegalTranscriptionStateError(
        `a transcription in status ${this.status} no longer changes placement`,
      );
    }
    this.placementChoice = p.placement;
    this.events.push({
      name: 'transcription.placement-changed',
      transcriptionId: this.id,
      ownerId: this.ownerId,
      placement: p.placement,
      occurredAt: p.at,
    });
  }

  correctSegment(p: { ordinal: number; text: string; at: Date }): void {
    if (this.status !== 'completed') {
      throw new TranscriptionNotCorrectableError(
        `a transcription in status ${this.status} is not correctable`,
      );
    }
    const index = this.segmentList.findIndex((segment) => segment.ordinal === p.ordinal);
    if (index === -1) {
      throw new SegmentNotFoundError(`no segment carries ordinal ${p.ordinal}`);
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

  /**
   * Diarization pass of the current run: each segment gets the speaker that covers the largest
   * share of its duration, and the discovered speakers replace the previous ones.
   *
   * The assignment is recomputed from scratch on every call: the worker can replay the same
   * publication without changing anything (its delivery is at-least-once). Names already given
   * by the owner survive an index that comes back — that is the owner's work, not the worker's.
   */
  assignSpeakers(p: { runId: string; turns: readonly SpeakerTurn[]; at: Date }): void {
    this.assertRunIsInProgress(p.runId, 'assign speakers');

    const previous = new Map(this.speakerList.map((speaker) => [speaker.index, speaker]));
    this.speakerList = distinctSpeakers(p.turns).map(
      (index) => previous.get(index) ?? Speaker.discovered(index),
    );
    this.segmentList = this.segmentList.map((segment) =>
      segment.withSpeaker(dominantSpeaker(p.turns, segment.range)),
    );

    this.events.push({
      name: 'transcription.speakers-assigned',
      transcriptionId: this.id,
      ownerId: this.ownerId,
      speakers: this.speakerList.map((speaker) => speaker.state()),
      segments: this.segmentList.map((segment) => segment.state()),
      occurredAt: p.at,
    });
  }

  /**
   * Naming a speaker applies to the whole transcription at once: that is the business gesture —
   * "that speaker there is Marc" — and not segment-by-segment editing.
   */
  renameSpeaker(p: { index: number; name: string; at: Date }): void {
    const position = this.speakerList.findIndex((speaker) => speaker.index === p.index);
    if (position === -1) {
      throw new SpeakerNotFoundError(`no speaker carries index ${p.index}`);
    }
    const name = SpeakerName.of(p.name);
    const renamed = [...this.speakerList];
    renamed[position] = this.speakerList[position].withName(name);
    this.speakerList = renamed;
    this.events.push({
      name: 'transcription.speaker-renamed',
      transcriptionId: this.id,
      ownerId: this.ownerId,
      index: p.index,
      speakerName: name.value,
      occurredAt: p.at,
    });
  }

  /**
   * Does this pass still open the media? The question belongs to the domain: the answer is the
   * very invariant that lets a run write, and media access control must follow the aggregate
   * when that invariant is tightened.
   */
  grantsMediaAccessTo(runId: string): boolean {
    return this.status === 'transcribing' && this.currentRunId === runId;
  }

  render(format: SubtitleFormat): string {
    return renderSubtitles(this.segmentList, format, this.speakerList);
  }

  /** Drains and returns the accumulated events: publish them after a successful save. */
  pullEvents(): TranscriptionEvent[] {
    return this.events.splice(0, this.events.length);
  }

  state(): TranscriptionState {
    return {
      id: this.id,
      ownerId: this.ownerId,
      status: this.status,
      placement: this.placementChoice,
      model: this.settings.model,
      language: this.settings.language,
      mediaStorageKey: this.media.storageKey,
      mediaOriginalName: this.media.originalName,
      mediaContentType: this.media.contentType,
      mediaByteSize: this.media.byteSize,
      attempts: this.attempts,
      currentRunId: this.currentRunId,
      claimedBy: this.claimedBy,
      // `Date` is mutable: without a copy, a caller could close a lease without going through
      // a domain method. The constructor and `restore` copy symmetrically on the way in.
      leaseExpiresAt: this.leaseExpiresAt === null ? null : new Date(this.leaseExpiresAt),
      lastAppliedBatchSequence: this.lastAppliedBatchSequence,
      failureReason: this.failureReason,
      requestedAt: new Date(this.requestedAtInstant),
      completedAt: this.completedAt === null ? null : new Date(this.completedAt),
      segments: this.segmentList.map((segment) => segment.state()),
      speakers: this.speakerList.map((speaker) => speaker.state()),
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
   * Only the current run drives the transcription: a run that has been replaced (expired lease,
   * then picked up again) is no longer allowed to write, and nothing is written outside the
   * `transcribing` state.
   */
  private assertRunIsInProgress(runId: string, intent: string): void {
    if (this.status !== 'transcribing') {
      throw new IllegalTranscriptionStateError(
        `cannot ${intent}: the transcription is in status ${this.status}`,
      );
    }
    if (!this.grantsMediaAccessTo(runId)) {
      throw new StaleRunError(`cannot ${intent}: this run has been replaced`);
    }
  }

  /**
   * Context policy: a lease is a bounded window that starts at the given instant. A duration of
   * zero or less is not a lease — refusing it here stops a caller from setting an expiry in the
   * past, or in ten years.
   */
  private static leaseWindow(at: Date, leaseSeconds: number): Date {
    if (!Number.isFinite(leaseSeconds) || leaseSeconds <= 0) {
      throw new InvalidLeaseDurationError(
        `a lease lasts a positive number of seconds, received ${leaseSeconds}`,
      );
    }
    return new Date(at.getTime() + leaseSeconds * 1_000);
  }
}
