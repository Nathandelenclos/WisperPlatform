import { beforeEach, describe, expect, it } from 'vitest';

import {
  IllegalTranscriptionStateError,
  OutOfOrderBatchError,
  OverlappingSegmentsError,
  SegmentNotFoundError,
  StaleRunError,
  TranscriptionNotCorrectableError,
} from './errors';
import { MediaAsset } from './media-asset';
import { TimeRange } from './time-range';
import { Transcription, type TranscriptionState } from './transcription';
import { TranscriptionSettings } from './transcription-settings';

const REQUESTED_AT = new Date('2026-03-01T10:00:00.000Z');
const LEASE_UNTIL = new Date('2026-03-01T10:01:00.000Z');

function aPendingTranscription(): Transcription {
  const transcription = Transcription.request({
    id: '11111111-1111-4111-8111-111111111111',
    ownerId: 'owner-a',
    media: MediaAsset.stored({
      storageKey: '22222222-2222-4222-8222-222222222222',
      originalName: 'reunion.m4a',
      contentType: 'audio/mp4',
      byteSize: 12_345,
    }),
    settings: TranscriptionSettings.of('small', 'fr'),
    requestedAt: REQUESTED_AT,
  });
  transcription.pullEvents();
  return transcription;
}

function aStartedTranscription(runId = 'run-1'): Transcription {
  const transcription = aPendingTranscription();
  transcription.startTranscribing({
    runId,
    workerId: 'worker-1',
    leaseExpiresAt: LEASE_UNTIL,
    at: REQUESTED_AT,
  });
  transcription.pullEvents();
  return transcription;
}

function batch(...spans: [number, number, string][]): { range: TimeRange; text: string }[] {
  return spans.map(([startMs, endMs, text]) => ({
    range: TimeRange.fromMilliseconds(startMs, endMs),
    text,
  }));
}

describe('Transcription — demande', () => {
  it('naît en attente et annonce la demande', () => {
    const transcription = Transcription.request({
      id: 'id-1',
      ownerId: 'owner-a',
      media: MediaAsset.stored({
        storageKey: 'key-1',
        originalName: 'a.mp3',
        contentType: 'audio/mpeg',
        byteSize: 10,
      }),
      settings: TranscriptionSettings.of('base', 'fr'),
      requestedAt: REQUESTED_AT,
    });

    const state = transcription.state();
    expect(state.status).toBe('pending');
    expect(state.attempts).toBe(0);
    expect(state.segments).toEqual([]);
    expect(state.lastAppliedBatchSequence).toBe(0);
    expect(state.currentRunId).toBeNull();
    expect(transcription.pullEvents()).toEqual([
      {
        name: 'transcription.requested',
        transcriptionId: 'id-1',
        ownerId: 'owner-a',
        occurredAt: REQUESTED_AT,
      },
    ]);
  });

  it('vide sa réserve d\'événements une fois qu\'on les a tirés', () => {
    const transcription = aPendingTranscription();

    expect(transcription.pullEvents()).toEqual([]);
  });
});

// Invariant 1
describe('Transcription — démarrage d\'une tentative', () => {
  it('passe en transcription, compte la tentative et pose le bail', () => {
    const transcription = aPendingTranscription();

    transcription.startTranscribing({
      runId: 'run-1',
      workerId: 'worker-1',
      leaseExpiresAt: LEASE_UNTIL,
      at: REQUESTED_AT,
    });

    const state = transcription.state();
    expect(state.status).toBe('transcribing');
    expect(state.attempts).toBe(1);
    expect(state.currentRunId).toBe('run-1');
    expect(state.claimedBy).toBe('worker-1');
    expect(state.leaseExpiresAt).toEqual(LEASE_UNTIL);
    expect(state.lastAppliedBatchSequence).toBe(0);
    expect(transcription.pullEvents()).toEqual([
      {
        name: 'transcription.started',
        transcriptionId: transcription.id,
        ownerId: 'owner-a',
        runId: 'run-1',
        occurredAt: REQUESTED_AT,
      },
    ]);
  });

  it('abandonne les segments de la tentative précédente', () => {
    const transcription = aStartedTranscription();
    transcription.appendTranscribedSegments({
      runId: 'run-1',
      batchSequence: 1,
      segments: batch([0, 1_000, 'perdu']),
    });
    transcription.requeueExpiredLease({ at: LEASE_UNTIL, maxAttempts: 3 });
    transcription.pullEvents();

    transcription.startTranscribing({
      runId: 'run-2',
      workerId: 'worker-2',
      leaseExpiresAt: LEASE_UNTIL,
      at: REQUESTED_AT,
    });

    const state = transcription.state();
    expect(state.segments).toEqual([]);
    expect(state.lastAppliedBatchSequence).toBe(0);
    expect(state.attempts).toBe(2);
  });

  it('n\'est légal que depuis l\'attente', () => {
    const transcription = aStartedTranscription();

    expect(() =>
      transcription.startTranscribing({
        runId: 'run-2',
        workerId: 'worker-2',
        leaseExpiresAt: LEASE_UNTIL,
        at: REQUESTED_AT,
      }),
    ).toThrow(IllegalTranscriptionStateError);
  });
});

// Invariant 2
describe('Transcription — flux de segments', () => {
  let transcription: Transcription;

  beforeEach(() => {
    transcription = aStartedTranscription();
  });

  it('numérote les segments dans l\'ordre d\'arrivée, lot après lot', () => {
    transcription.appendTranscribedSegments({
      runId: 'run-1',
      batchSequence: 1,
      segments: batch([0, 1_000, 'un'], [1_000, 2_000, 'deux']),
    });
    transcription.appendTranscribedSegments({
      runId: 'run-1',
      batchSequence: 2,
      segments: batch([2_500, 3_000, 'trois']),
    });

    expect(transcription.state().segments).toEqual([
      { ordinal: 1, startMs: 0, endMs: 1_000, text: 'un', corrected: false },
      { ordinal: 2, startMs: 1_000, endMs: 2_000, text: 'deux', corrected: false },
      { ordinal: 3, startMs: 2_500, endMs: 3_000, text: 'trois', corrected: false },
    ]);
    expect(transcription.state().lastAppliedBatchSequence).toBe(2);
  });

  it('annonce uniquement les segments du lot qui vient d\'arriver', () => {
    transcription.appendTranscribedSegments({
      runId: 'run-1',
      batchSequence: 1,
      segments: batch([0, 1_000, 'un']),
    });
    transcription.pullEvents();

    transcription.appendTranscribedSegments({
      runId: 'run-1',
      batchSequence: 2,
      segments: batch([1_000, 2_000, 'deux']),
    });

    const events = transcription.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: 'transcription.segments-appended',
      transcriptionId: transcription.id,
      ownerId: 'owner-a',
      segments: [{ ordinal: 2, startMs: 1_000, endMs: 2_000, text: 'deux', corrected: false }],
    });
  });

  it('ignore en silence le rejeu d\'un lot déjà appliqué', () => {
    const applied = {
      runId: 'run-1',
      batchSequence: 1,
      segments: batch([0, 1_000, 'un']),
    };
    transcription.appendTranscribedSegments(applied);
    transcription.pullEvents();

    transcription.appendTranscribedSegments(applied);

    expect(transcription.state().segments).toHaveLength(1);
    expect(transcription.pullEvents()).toEqual([]);
  });

  it('refuse un lot qui saute une place dans la séquence', () => {
    expect(() =>
      transcription.appendTranscribedSegments({
        runId: 'run-1',
        batchSequence: 2,
        segments: batch([0, 1_000, 'un']),
      }),
    ).toThrow(OutOfOrderBatchError);
  });

  it('refuse des segments qui se chevauchent dans le lot', () => {
    expect(() =>
      transcription.appendTranscribedSegments({
        runId: 'run-1',
        batchSequence: 1,
        segments: batch([0, 1_500, 'un'], [1_000, 2_000, 'deux']),
      }),
    ).toThrow(OverlappingSegmentsError);
  });

  it('refuse un lot qui revient avant le dernier segment déjà reçu', () => {
    transcription.appendTranscribedSegments({
      runId: 'run-1',
      batchSequence: 1,
      segments: batch([0, 2_000, 'un']),
    });

    expect(() =>
      transcription.appendTranscribedSegments({
        runId: 'run-1',
        batchSequence: 2,
        segments: batch([1_999, 3_000, 'deux']),
      }),
    ).toThrow(OverlappingSegmentsError);
  });

  it('refuse un lot venu d\'une tentative remplacée', () => {
    expect(() =>
      transcription.appendTranscribedSegments({
        runId: 'run-perime',
        batchSequence: 1,
        segments: batch([0, 1_000, 'un']),
      }),
    ).toThrow(StaleRunError);
  });

  it('refuse un lot quand la transcription n\'est plus en cours', () => {
    transcription.complete({ runId: 'run-1', at: LEASE_UNTIL });

    expect(() =>
      transcription.appendTranscribedSegments({
        runId: 'run-1',
        batchSequence: 1,
        segments: batch([0, 1_000, 'un']),
      }),
    ).toThrow(IllegalTranscriptionStateError);
  });

  it('fait avancer la séquence même quand le lot est vide de parole', () => {
    transcription.appendTranscribedSegments({ runId: 'run-1', batchSequence: 1, segments: [] });
    transcription.appendTranscribedSegments({
      runId: 'run-1',
      batchSequence: 2,
      segments: batch([0, 1_000, 'un']),
    });

    expect(transcription.state().segments).toHaveLength(1);
    expect(transcription.state().lastAppliedBatchSequence).toBe(2);
  });
});

describe('Transcription — bail', () => {
  it('repousse le bail du run courant sans produire d\'événement', () => {
    const transcription = aStartedTranscription();
    const renewed = new Date('2026-03-01T10:02:00.000Z');

    transcription.renewLease({ runId: 'run-1', leaseExpiresAt: renewed });

    expect(transcription.state().leaseExpiresAt).toEqual(renewed);
    expect(transcription.pullEvents()).toEqual([]);
  });

  it('refuse de repousser le bail d\'une tentative remplacée', () => {
    const transcription = aStartedTranscription();

    expect(() =>
      transcription.renewLease({ runId: 'autre-run', leaseExpiresAt: LEASE_UNTIL }),
    ).toThrow(StaleRunError);
  });
});

// Invariant 3
describe('Transcription — complétion', () => {
  it('achève la transcription et libère le bail', () => {
    const transcription = aStartedTranscription();
    transcription.appendTranscribedSegments({
      runId: 'run-1',
      batchSequence: 1,
      segments: batch([0, 1_000, 'un']),
    });
    transcription.pullEvents();

    transcription.complete({ runId: 'run-1', at: LEASE_UNTIL });

    const state = transcription.state();
    expect(state.status).toBe('completed');
    expect(state.completedAt).toEqual(LEASE_UNTIL);
    expect(state.leaseExpiresAt).toBeNull();
    expect(transcription.pullEvents()).toEqual([
      {
        name: 'transcription.completed',
        transcriptionId: transcription.id,
        ownerId: 'owner-a',
        occurredAt: LEASE_UNTIL,
      },
    ]);
  });

  it('accepte une transcription sans aucun segment : le média peut être muet', () => {
    const transcription = aStartedTranscription();

    transcription.complete({ runId: 'run-1', at: LEASE_UNTIL });

    expect(transcription.state().status).toBe('completed');
    expect(transcription.state().segments).toEqual([]);
  });

  it('refuse la complétion hors tentative en cours', () => {
    const pending = aPendingTranscription();
    expect(() => pending.complete({ runId: 'run-1', at: LEASE_UNTIL })).toThrow(
      IllegalTranscriptionStateError,
    );

    const started = aStartedTranscription();
    expect(() => started.complete({ runId: 'autre-run', at: LEASE_UNTIL })).toThrow(StaleRunError);
  });
});

// Invariant 4
describe('Transcription — échec', () => {
  it('passe en échec, retient la raison et libère le bail', () => {
    const transcription = aStartedTranscription();

    transcription.fail({ runId: 'run-1', reason: 'whisper a rendu 137', at: LEASE_UNTIL });

    const state = transcription.state();
    expect(state.status).toBe('failed');
    expect(state.failureReason).toBe('whisper a rendu 137');
    expect(state.leaseExpiresAt).toBeNull();
    expect(transcription.pullEvents()).toEqual([
      {
        name: 'transcription.failed',
        transcriptionId: transcription.id,
        ownerId: 'owner-a',
        reason: 'whisper a rendu 137',
        occurredAt: LEASE_UNTIL,
      },
    ]);
  });

  it('refuse l\'échec hors tentative en cours', () => {
    const transcription = aStartedTranscription();

    expect(() => transcription.fail({ runId: 'x', reason: 'boum', at: LEASE_UNTIL })).toThrow(
      StaleRunError,
    );
  });
});

// Invariant 5
describe('Transcription — bail expiré', () => {
  const expired = new Date(LEASE_UNTIL.getTime() + 1);

  it('remet la demande en file quand il reste des tentatives', () => {
    const transcription = aStartedTranscription();

    transcription.requeueExpiredLease({ at: expired, maxAttempts: 3 });

    const state = transcription.state();
    expect(state.status).toBe('pending');
    expect(state.currentRunId).toBeNull();
    expect(state.claimedBy).toBeNull();
    expect(state.leaseExpiresAt).toBeNull();
    expect(state.attempts).toBe(1);
    expect(transcription.pullEvents()).toEqual([
      {
        name: 'transcription.requeued',
        transcriptionId: transcription.id,
        ownerId: 'owner-a',
        occurredAt: expired,
      },
    ]);
  });

  it('abandonne quand les tentatives sont épuisées', () => {
    const transcription = aStartedTranscription();

    transcription.requeueExpiredLease({ at: expired, maxAttempts: 1 });

    const state = transcription.state();
    expect(state.status).toBe('failed');
    expect(state.failureReason).toBe('lease expired');
    expect(transcription.pullEvents()).toEqual([
      {
        name: 'transcription.failed',
        transcriptionId: transcription.id,
        ownerId: 'owner-a',
        reason: 'lease expired',
        occurredAt: expired,
      },
    ]);
  });

  it('ne fait rien tant que le bail court encore', () => {
    const transcription = aStartedTranscription();

    transcription.requeueExpiredLease({ at: new Date(LEASE_UNTIL.getTime() - 1), maxAttempts: 3 });

    expect(transcription.state().status).toBe('transcribing');
    expect(transcription.pullEvents()).toEqual([]);
  });

  it('ne fait rien sur une transcription qui n\'est pas en cours', () => {
    const transcription = aPendingTranscription();

    transcription.requeueExpiredLease({ at: expired, maxAttempts: 3 });

    expect(transcription.state().status).toBe('pending');
    expect(transcription.pullEvents()).toEqual([]);
  });
});

// Invariant 6
describe('Transcription — correction', () => {
  function aCompletedTranscription(): Transcription {
    const transcription = aStartedTranscription();
    transcription.appendTranscribedSegments({
      runId: 'run-1',
      batchSequence: 1,
      segments: batch([0, 1_000, 'bonjur'], [1_000, 2_000, 'a tous']),
    });
    transcription.complete({ runId: 'run-1', at: LEASE_UNTIL });
    transcription.pullEvents();
    return transcription;
  }

  it('remplace le texte d\'un segment et le marque corrigé', () => {
    const transcription = aCompletedTranscription();

    transcription.correctSegment({ ordinal: 1, text: 'bonjour', at: LEASE_UNTIL });

    expect(transcription.state().segments[0]).toEqual({
      ordinal: 1,
      startMs: 0,
      endMs: 1_000,
      text: 'bonjour',
      corrected: true,
    });
    expect(transcription.state().segments[1].corrected).toBe(false);
    expect(transcription.pullEvents()).toEqual([
      {
        name: 'transcription.segment-corrected',
        transcriptionId: transcription.id,
        ownerId: 'owner-a',
        ordinal: 1,
        occurredAt: LEASE_UNTIL,
      },
    ]);
  });

  it('refuse la correction d\'une transcription qui n\'est pas achevée', () => {
    const transcription = aStartedTranscription();

    expect(() => transcription.correctSegment({ ordinal: 1, text: 'x', at: LEASE_UNTIL })).toThrow(
      TranscriptionNotCorrectableError,
    );
  });

  it('refuse un ordinal inconnu', () => {
    const transcription = aCompletedTranscription();

    expect(() => transcription.correctSegment({ ordinal: 99, text: 'x', at: LEASE_UNTIL })).toThrow(
      SegmentNotFoundError,
    );
  });

  it('refuse une correction au texte vide', () => {
    const transcription = aCompletedTranscription();

    expect(() => transcription.correctSegment({ ordinal: 1, text: ' ', at: LEASE_UNTIL })).toThrow(
      expect.objectContaining({ code: 'INVALID_SEGMENT_TEXT' }),
    );
  });

  it('rend les sous-titres avec le texte corrigé', () => {
    const transcription = aCompletedTranscription();

    transcription.correctSegment({ ordinal: 1, text: 'bonjour', at: LEASE_UNTIL });

    expect(transcription.render('txt')).toBe('bonjour\na tous\n');
  });
});

// Invariant 7
describe('Transcription — aller-retour de persistance', () => {
  it('rend exactement l\'état qu\'on lui a confié', () => {
    const state: TranscriptionState = {
      id: '33333333-3333-4333-8333-333333333333',
      ownerId: 'owner-b',
      status: 'transcribing',
      model: 'medium',
      language: 'French',
      mediaStorageKey: '44444444-4444-4444-8444-444444444444',
      mediaOriginalName: 'conference.wav',
      mediaContentType: 'audio/wav',
      mediaByteSize: 987_654,
      attempts: 2,
      currentRunId: '55555555-5555-4555-8555-555555555555',
      claimedBy: 'worker-7',
      leaseExpiresAt: LEASE_UNTIL,
      lastAppliedBatchSequence: 4,
      failureReason: null,
      requestedAt: REQUESTED_AT,
      completedAt: null,
      segments: [
        { ordinal: 1, startMs: 0, endMs: 1_000, text: 'un', corrected: false },
        { ordinal: 2, startMs: 1_000, endMs: 2_000, text: 'deux', corrected: true },
      ],
    };

    expect(Transcription.restore(state).state()).toEqual(state);
  });

  it('reprend le fil du flux de segments après une relecture', () => {
    const original = aStartedTranscription();
    original.appendTranscribedSegments({
      runId: 'run-1',
      batchSequence: 1,
      segments: batch([0, 1_000, 'un']),
    });

    const reloaded = Transcription.restore(original.state());
    reloaded.appendTranscribedSegments({
      runId: 'run-1',
      batchSequence: 2,
      segments: batch([1_000, 2_000, 'deux']),
    });

    expect(reloaded.state().segments.map((segment) => segment.ordinal)).toEqual([1, 2]);
    expect(reloaded.state().lastAppliedBatchSequence).toBe(2);
  });

  it('ne ressort pas les événements d\'une vie antérieure', () => {
    const original = aPendingTranscription();

    expect(Transcription.restore(original.state()).pullEvents()).toEqual([]);
  });
});
