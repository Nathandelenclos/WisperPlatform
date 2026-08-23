import { describe, expect, it } from 'vitest';

import { InvalidSpeakerError } from './errors';
import { SpeakerTurn, distinctSpeakers, dominantSpeaker } from './speaker-turn';
import { TimeRange } from './time-range';

function turn(startMs: number, endMs: number, speaker: number): SpeakerTurn {
  return SpeakerTurn.of(TimeRange.fromMilliseconds(startMs, endMs), speaker);
}

const segment = TimeRange.fromMilliseconds(1_000, 2_000);

describe('SpeakerTurn', () => {
  it('carries the time range and the index of the speaker', () => {
    const speakerTurn = turn(0, 500, 3);

    expect(speakerTurn.speakerIndex).toBe(3);
    expect(speakerTurn.range.startMs).toBe(0);
    expect(speakerTurn.range.endMs).toBe(500);
  });

  it('rejects an index that is not a non-negative integer', () => {
    expect(() => turn(0, 500, -1)).toThrow(InvalidSpeakerError);
    expect(() => turn(0, 500, 0.5)).toThrow(expect.objectContaining({ code: 'INVALID_SPEAKER' }));
  });
});

describe('dominantSpeaker', () => {
  it('returns the speaker who covers the largest share of the segment', () => {
    const turns = [turn(0, 1_400, 0), turn(1_400, 3_000, 1)];

    // 400 ms for speaker 0, 600 ms for speaker 1.
    expect(dominantSpeaker(turns, segment)).toBe(1);
  });

  it('returns the same speaker for every segment a long turn encloses', () => {
    const turns = [turn(0, 10_000, 2)];

    expect(dominantSpeaker(turns, TimeRange.fromMilliseconds(0, 1_000))).toBe(2);
    expect(dominantSpeaker(turns, segment)).toBe(2);
    expect(dominantSpeaker(turns, TimeRange.fromMilliseconds(9_000, 9_500))).toBe(2);
  });

  it('adds up the turns of one and the same speaker instead of keeping the longest', () => {
    // Speaker 0 talks twice for 300 ms, speaker 1 once for 400 ms: 0 wins.
    const turns = [turn(1_000, 1_300, 0), turn(1_300, 1_700, 1), turn(1_700, 2_000, 0)];

    expect(dominantSpeaker(turns, segment)).toBe(0);
  });

  it('returns the smallest index on equal overlap', () => {
    const turns = [turn(1_000, 1_500, 1), turn(1_500, 2_000, 0)];

    expect(dominantSpeaker(turns, segment)).toBe(0);
  });

  it('does not depend on the order of the turns on input', () => {
    const ordered = [turn(0, 1_200, 0), turn(1_200, 1_600, 2), turn(1_600, 3_000, 1)];
    const shuffled = [ordered[2], ordered[0], ordered[1]];

    expect(dominantSpeaker(shuffled, segment)).toBe(dominantSpeaker(ordered, segment));
  });

  it('returns null when no turn overlaps the segment', () => {
    // A turn that touches the bound of the segment does not overlap it: the overlap is zero.
    expect(dominantSpeaker([turn(0, 1_000, 0), turn(2_000, 3_000, 1)], segment)).toBeNull();
    expect(dominantSpeaker([], segment)).toBeNull();
  });
});

describe('distinctSpeakers', () => {
  it('returns the distinct indices, sorted in ascending order', () => {
    const turns = [turn(0, 100, 2), turn(100, 200, 0), turn(200, 300, 2), turn(300, 400, 1)];

    expect(distinctSpeakers(turns)).toEqual([0, 1, 2]);
  });

  it('finds no speaker without any speaker turn', () => {
    expect(distinctSpeakers([])).toEqual([]);
  });
});
