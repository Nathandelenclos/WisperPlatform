import { describe, expect, it } from 'vitest';

import { InvalidSpeakerError } from './errors';
import { SpeakerTurn, distinctSpeakers, dominantSpeaker } from './speaker-turn';
import { TimeRange } from './time-range';

function turn(startMs: number, endMs: number, speaker: number): SpeakerTurn {
  return SpeakerTurn.of(TimeRange.fromMilliseconds(startMs, endMs), speaker);
}

const segment = TimeRange.fromMilliseconds(1_000, 2_000);

describe('SpeakerTurn', () => {
  it('porte l\'intervalle et l\'indice du locuteur', () => {
    const speakerTurn = turn(0, 500, 3);

    expect(speakerTurn.speakerIndex).toBe(3);
    expect(speakerTurn.range.startMs).toBe(0);
    expect(speakerTurn.range.endMs).toBe(500);
  });

  it('refuse un indice qui n\'est pas un entier positif ou nul', () => {
    expect(() => turn(0, 500, -1)).toThrow(InvalidSpeakerError);
    expect(() => turn(0, 500, 0.5)).toThrow(expect.objectContaining({ code: 'INVALID_SPEAKER' }));
  });
});

describe('dominantSpeaker', () => {
  it('rend le locuteur qui recouvre la plus grande part du segment', () => {
    const turns = [turn(0, 1_400, 0), turn(1_400, 3_000, 1)];

    // 400 ms pour le locuteur 0, 600 ms pour le locuteur 1.
    expect(dominantSpeaker(turns, segment)).toBe(1);
  });

  it('rend le même locuteur pour tous les segments qu\'un long tour englobe', () => {
    const turns = [turn(0, 10_000, 2)];

    expect(dominantSpeaker(turns, TimeRange.fromMilliseconds(0, 1_000))).toBe(2);
    expect(dominantSpeaker(turns, segment)).toBe(2);
    expect(dominantSpeaker(turns, TimeRange.fromMilliseconds(9_000, 9_500))).toBe(2);
  });

  it('additionne les tours d\'un même locuteur au lieu de garder le plus long', () => {
    // Le locuteur 0 parle deux fois 300 ms, le locuteur 1 une fois 400 ms : 0 l'emporte.
    const turns = [turn(1_000, 1_300, 0), turn(1_300, 1_700, 1), turn(1_700, 2_000, 0)];

    expect(dominantSpeaker(turns, segment)).toBe(0);
  });

  it('rend le plus petit indice à égalité de recouvrement', () => {
    const turns = [turn(1_000, 1_500, 1), turn(1_500, 2_000, 0)];

    expect(dominantSpeaker(turns, segment)).toBe(0);
  });

  it('ne dépend pas de l\'ordre des tours en entrée', () => {
    const ordered = [turn(0, 1_200, 0), turn(1_200, 1_600, 2), turn(1_600, 3_000, 1)];
    const shuffled = [ordered[2], ordered[0], ordered[1]];

    expect(dominantSpeaker(shuffled, segment)).toBe(dominantSpeaker(ordered, segment));
  });

  it('rend null quand aucun tour ne recouvre le segment', () => {
    // Un tour qui touche la borne du segment ne le recouvre pas : le recouvrement est nul.
    expect(dominantSpeaker([turn(0, 1_000, 0), turn(2_000, 3_000, 1)], segment)).toBeNull();
    expect(dominantSpeaker([], segment)).toBeNull();
  });
});

describe('distinctSpeakers', () => {
  it('rend les indices distincts, triés par ordre croissant', () => {
    const turns = [turn(0, 100, 2), turn(100, 200, 0), turn(200, 300, 2), turn(300, 400, 1)];

    expect(distinctSpeakers(turns)).toEqual([0, 1, 2]);
  });

  it('ne trouve aucun locuteur sans tour de parole', () => {
    expect(distinctSpeakers([])).toEqual([]);
  });
});
