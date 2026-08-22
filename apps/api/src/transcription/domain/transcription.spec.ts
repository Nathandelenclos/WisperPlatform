import { beforeEach, describe, expect, it } from 'vitest';

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
import { MediaAsset } from './media-asset';
import { SpeakerTurn } from './speaker-turn';
import { TimeRange } from './time-range';
import { Transcription, type TranscriptionState } from './transcription';
import { TranscriptionSettings } from './transcription-settings';

const REQUESTED_AT = new Date('2026-03-01T10:00:00.000Z');
const LEASE_UNTIL = new Date('2026-03-01T10:01:00.000Z');
// Instant fourni par l'horloge applicative quand un lot de segments arrive.
const SEGMENTS_AT = new Date('2026-03-01T10:00:30.000Z');
// Durée d'un bail dans les tests : LEASE_UNTIL = REQUESTED_AT + LEASE_SECONDS.
const LEASE_SECONDS = 60;

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
    leaseSeconds: LEASE_SECONDS,
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
      leaseSeconds: LEASE_SECONDS,
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
      at: SEGMENTS_AT,
      runId: 'run-1',
      batchSequence: 1,
      segments: batch([0, 1_000, 'perdu']),
    });
    transcription.requeueExpiredLease({ at: LEASE_UNTIL, maxAttempts: 3 });
    transcription.pullEvents();

    transcription.startTranscribing({
      runId: 'run-2',
      workerId: 'worker-2',
      leaseSeconds: LEASE_SECONDS,
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
        leaseSeconds: LEASE_SECONDS,
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
      at: SEGMENTS_AT,
      runId: 'run-1',
      batchSequence: 1,
      segments: batch([0, 1_000, 'un'], [1_000, 2_000, 'deux']),
    });
    transcription.appendTranscribedSegments({
      at: SEGMENTS_AT,
      runId: 'run-1',
      batchSequence: 2,
      segments: batch([2_500, 3_000, 'trois']),
    });

    expect(transcription.state().segments).toEqual([
      { ordinal: 1, startMs: 0, endMs: 1_000, text: 'un', corrected: false, speakerIndex: null },
      {
        ordinal: 2,
        startMs: 1_000,
        endMs: 2_000,
        text: 'deux',
        corrected: false,
        speakerIndex: null,
      },
      {
        ordinal: 3,
        startMs: 2_500,
        endMs: 3_000,
        text: 'trois',
        corrected: false,
        speakerIndex: null,
      },
    ]);
    expect(transcription.state().lastAppliedBatchSequence).toBe(2);
  });

  it('annonce uniquement les segments du lot qui vient d\'arriver', () => {
    transcription.appendTranscribedSegments({
      at: SEGMENTS_AT,
      runId: 'run-1',
      batchSequence: 1,
      segments: batch([0, 1_000, 'un']),
    });
    transcription.pullEvents();

    transcription.appendTranscribedSegments({
      at: SEGMENTS_AT,
      runId: 'run-1',
      batchSequence: 2,
      segments: batch([1_000, 2_000, 'deux']),
    });

    const events = transcription.pullEvents();
    expect(events).toHaveLength(1);
    // `toEqual` et non `toMatchObject` : c'est l'omission d'`occurredAt` qui avait laissé une
    // horloge murale s'installer dans l'aggregate.
    expect(events[0]).toEqual({
      name: 'transcription.segments-appended',
      transcriptionId: transcription.id,
      ownerId: 'owner-a',
      segments: [
        {
          ordinal: 2,
          startMs: 1_000,
          endMs: 2_000,
          text: 'deux',
          corrected: false,
          speakerIndex: null,
        },
      ],
      occurredAt: SEGMENTS_AT,
    });
  });

  it('ignore en silence le rejeu d\'un lot déjà appliqué', () => {
    const applied = {
      at: SEGMENTS_AT,
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
        at: SEGMENTS_AT,
        runId: 'run-1',
        batchSequence: 2,
        segments: batch([0, 1_000, 'un']),
      }),
    ).toThrow(OutOfOrderBatchError);
  });

  it('refuse des segments qui se chevauchent dans le lot', () => {
    expect(() =>
      transcription.appendTranscribedSegments({
        at: SEGMENTS_AT,
        runId: 'run-1',
        batchSequence: 1,
        segments: batch([0, 1_500, 'un'], [1_000, 2_000, 'deux']),
      }),
    ).toThrow(OverlappingSegmentsError);
  });

  it('refuse un lot qui revient avant le dernier segment déjà reçu', () => {
    transcription.appendTranscribedSegments({
      at: SEGMENTS_AT,
      runId: 'run-1',
      batchSequence: 1,
      segments: batch([0, 2_000, 'un']),
    });

    expect(() =>
      transcription.appendTranscribedSegments({
        at: SEGMENTS_AT,
        runId: 'run-1',
        batchSequence: 2,
        segments: batch([1_999, 3_000, 'deux']),
      }),
    ).toThrow(OverlappingSegmentsError);
  });

  it('refuse un lot venu d\'une tentative remplacée', () => {
    expect(() =>
      transcription.appendTranscribedSegments({
        at: SEGMENTS_AT,
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
        at: SEGMENTS_AT,
        runId: 'run-1',
        batchSequence: 1,
        segments: batch([0, 1_000, 'un']),
      }),
    ).toThrow(IllegalTranscriptionStateError);
  });

  it('fait avancer la séquence même quand le lot est vide de parole', () => {
    transcription.appendTranscribedSegments({ at: SEGMENTS_AT, runId: 'run-1', batchSequence: 1, segments: [] });
    transcription.appendTranscribedSegments({
      at: SEGMENTS_AT,
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
    // Le bail court LEASE_SECONDS à partir de l'instant du signe de vie, dérivé par l'aggregate.
    const renewedAt = new Date('2026-03-01T10:01:00.000Z');
    const renewed = new Date('2026-03-01T10:02:00.000Z');

    transcription.renewLease({ runId: 'run-1', leaseSeconds: LEASE_SECONDS, at: renewedAt });

    expect(transcription.state().leaseExpiresAt).toEqual(renewed);
    expect(transcription.leaseExpiry).toEqual(renewed);
    expect(transcription.pullEvents()).toEqual([]);
  });

  it('refuse de repousser le bail d\'une tentative remplacée', () => {
    const transcription = aStartedTranscription();

    expect(() =>
      transcription.renewLease({ runId: 'autre-run', leaseSeconds: LEASE_SECONDS, at: REQUESTED_AT }),
    ).toThrow(StaleRunError);
  });

  it('refuse une durée de bail qui n\'en est pas une', () => {
    const transcription = aStartedTranscription();

    for (const leaseSeconds of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        transcription.renewLease({ runId: 'run-1', leaseSeconds, at: REQUESTED_AT }),
      ).toThrow(InvalidLeaseDurationError);
    }
  });
});

// Invariant 3
describe('Transcription — complétion', () => {
  it('achève la transcription et libère le bail', () => {
    const transcription = aStartedTranscription();
    transcription.appendTranscribedSegments({
      at: SEGMENTS_AT,
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
      at: SEGMENTS_AT,
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
      speakerIndex: null,
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
describe('Transcription — diarisation', () => {
  /** Trois segments d'une seconde chacun, contigus, sur un run ouvert. */
  function aTranscribedTranscription(): Transcription {
    const transcription = aStartedTranscription();
    transcription.appendTranscribedSegments({
      at: SEGMENTS_AT,
      runId: 'run-1',
      batchSequence: 1,
      segments: batch([0, 1_000, 'un'], [1_000, 2_000, 'deux'], [2_000, 3_000, 'trois']),
    });
    transcription.pullEvents();
    return transcription;
  }

  function turns(...spans: [number, number, number][]): SpeakerTurn[] {
    return spans.map(([startMs, endMs, speaker]) =>
      SpeakerTurn.of(TimeRange.fromMilliseconds(startMs, endMs), speaker),
    );
  }

  function assignedSpeakers(transcription: Transcription): (number | null)[] {
    return transcription.state().segments.map((segment) => segment.speakerIndex);
  }

  it('attribue à chaque segment le locuteur qui le recouvre le plus', () => {
    const transcription = aTranscribedTranscription();

    transcription.assignSpeakers({
      runId: 'run-1',
      turns: turns([0, 1_400, 0], [1_400, 3_000, 1]),
      at: SEGMENTS_AT,
    });

    // Le deuxième segment est partagé 400/600 ms : il revient au locuteur 1.
    expect(assignedSpeakers(transcription)).toEqual([0, 1, 1]);
    expect(transcription.state().speakers).toEqual([
      { index: 0, name: null },
      { index: 1, name: null },
    ]);
  });

  it('annonce les locuteurs découverts et les segments réattribués', () => {
    const transcription = aTranscribedTranscription();

    transcription.assignSpeakers({
      runId: 'run-1',
      turns: turns([0, 3_000, 0]),
      at: SEGMENTS_AT,
    });

    expect(transcription.pullEvents()).toEqual([
      {
        name: 'transcription.speakers-assigned',
        transcriptionId: transcription.id,
        ownerId: 'owner-a',
        speakers: [{ index: 0, name: null }],
        segments: transcription.state().segments,
        occurredAt: SEGMENTS_AT,
      },
    ]);
  });

  it('laisse sans locuteur un segment qu\'aucun tour ne recouvre', () => {
    const transcription = aTranscribedTranscription();

    transcription.assignSpeakers({
      runId: 'run-1',
      turns: turns([0, 1_000, 0], [2_000, 3_000, 0]),
      at: SEGMENTS_AT,
    });

    // Le tour s'arrête exactement où le deuxième segment commence : recouvrement nul.
    expect(assignedSpeakers(transcription)).toEqual([0, null, 0]);
  });

  it('ne dépend pas de l\'ordre des tours reçus', () => {
    const ordered = aTranscribedTranscription();
    const shuffled = aTranscribedTranscription();
    const spans: [number, number, number][] = [[0, 1_200, 0], [1_200, 1_800, 2], [1_800, 3_000, 1]];

    ordered.assignSpeakers({ runId: 'run-1', turns: turns(...spans), at: SEGMENTS_AT });
    shuffled.assignSpeakers({
      runId: 'run-1',
      turns: turns(spans[2], spans[0], spans[1]),
      at: SEGMENTS_AT,
    });

    expect(assignedSpeakers(shuffled)).toEqual(assignedSpeakers(ordered));
  });

  it('efface l\'attribution quand la diarisation ne rend aucun tour', () => {
    const transcription = aTranscribedTranscription();
    transcription.assignSpeakers({ runId: 'run-1', turns: turns([0, 3_000, 0]), at: SEGMENTS_AT });

    transcription.assignSpeakers({ runId: 'run-1', turns: [], at: SEGMENTS_AT });

    expect(assignedSpeakers(transcription)).toEqual([null, null, null]);
    expect(transcription.state().speakers).toEqual([]);
  });

  it('rend le même état quand le worker rejoue la même publication', () => {
    const transcription = aTranscribedTranscription();
    const spans: [number, number, number][] = [[0, 1_500, 1], [1_500, 3_000, 0]];
    transcription.assignSpeakers({ runId: 'run-1', turns: turns(...spans), at: SEGMENTS_AT });
    const once = transcription.state();

    transcription.assignSpeakers({ runId: 'run-1', turns: turns(...spans), at: SEGMENTS_AT });

    expect(transcription.state()).toEqual(once);
  });

  it('garde le nom déjà donné à un locuteur que la diarisation retrouve', () => {
    const transcription = aTranscribedTranscription();
    transcription.assignSpeakers({ runId: 'run-1', turns: turns([0, 3_000, 0]), at: SEGMENTS_AT });
    transcription.renameSpeaker({ index: 0, name: 'Marc', at: SEGMENTS_AT });

    transcription.assignSpeakers({
      runId: 'run-1',
      turns: turns([0, 1_500, 0], [1_500, 3_000, 1]),
      at: SEGMENTS_AT,
    });

    expect(transcription.state().speakers).toEqual([
      { index: 0, name: 'Marc' },
      { index: 1, name: null },
    ]);
  });

  it('refuse une attribution qui vient d\'une tentative remplacée', () => {
    const transcription = aTranscribedTranscription();

    expect(() =>
      transcription.assignSpeakers({
        runId: 'run-2',
        turns: turns([0, 3_000, 0]),
        at: SEGMENTS_AT,
      }),
    ).toThrow(StaleRunError);
  });

  it('oublie les locuteurs quand une nouvelle tentative démarre', () => {
    const transcription = aTranscribedTranscription();
    transcription.assignSpeakers({ runId: 'run-1', turns: turns([0, 3_000, 0]), at: SEGMENTS_AT });
    transcription.releaseRun({ runId: 'run-1', at: LEASE_UNTIL });

    transcription.startTranscribing({
      runId: 'run-2',
      workerId: 'worker-2',
      leaseSeconds: LEASE_SECONDS,
      at: LEASE_UNTIL,
    });

    expect(transcription.state().speakers).toEqual([]);
    expect(transcription.state().segments).toEqual([]);
  });

  it('renomme un locuteur pour toute la transcription d\'un coup', () => {
    const transcription = aTranscribedTranscription();
    transcription.assignSpeakers({
      runId: 'run-1',
      turns: turns([0, 1_000, 0], [1_000, 2_000, 1], [2_000, 3_000, 0]),
      at: SEGMENTS_AT,
    });
    transcription.pullEvents();

    transcription.renameSpeaker({ index: 0, name: '  Marc  ', at: LEASE_UNTIL });

    expect(transcription.render('txt')).toBe('Marc : un\nLocuteur 2 : deux\nMarc : trois\n');
    expect(transcription.pullEvents()).toEqual([
      {
        name: 'transcription.speaker-renamed',
        transcriptionId: transcription.id,
        ownerId: 'owner-a',
        index: 0,
        speakerName: 'Marc',
        occurredAt: LEASE_UNTIL,
      },
    ]);
  });

  it('refuse de renommer un locuteur que la diarisation n\'a pas trouvé', () => {
    const transcription = aTranscribedTranscription();
    transcription.assignSpeakers({ runId: 'run-1', turns: turns([0, 3_000, 0]), at: SEGMENTS_AT });

    expect(() => transcription.renameSpeaker({ index: 1, name: 'Marc', at: LEASE_UNTIL })).toThrow(
      SpeakerNotFoundError,
    );
  });

  it('refuse un nom de locuteur vide', () => {
    const transcription = aTranscribedTranscription();
    transcription.assignSpeakers({ runId: 'run-1', turns: turns([0, 3_000, 0]), at: SEGMENTS_AT });

    expect(() => transcription.renameSpeaker({ index: 0, name: ' ', at: LEASE_UNTIL })).toThrow(
      expect.objectContaining({ code: 'INVALID_SPEAKER_NAME' }),
    );
  });
});

// Invariant 8
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
        { ordinal: 1, startMs: 0, endMs: 1_000, text: 'un', corrected: false, speakerIndex: 0 },
        { ordinal: 2, startMs: 1_000, endMs: 2_000, text: 'deux', corrected: true, speakerIndex: 1 },
      ],
      speakers: [
        { index: 0, name: 'Marc' },
        { index: 1, name: null },
      ],
    };

    expect(Transcription.restore(state).state()).toEqual(state);
  });

  it('reprend le fil du flux de segments après une relecture', () => {
    const original = aStartedTranscription();
    original.appendTranscribedSegments({
      at: SEGMENTS_AT,
      runId: 'run-1',
      batchSequence: 1,
      segments: batch([0, 1_000, 'un']),
    });

    const reloaded = Transcription.restore(original.state());
    reloaded.appendTranscribedSegments({
      at: SEGMENTS_AT,
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
