import { describe, expect, it } from 'vitest';

import { InvalidTimeRangeError } from './errors';
import { TimeRange } from './time-range';

describe('TimeRange', () => {
  it('retient les bornes d\'un intervalle valide', () => {
    const range = TimeRange.fromMilliseconds(0, 1_500);

    expect(range.startMs).toBe(0);
    expect(range.endMs).toBe(1_500);
  });

  it('refuse un intervalle qui ne progresse pas dans le temps', () => {
    expect(() => TimeRange.fromMilliseconds(1_000, 1_000)).toThrow(InvalidTimeRangeError);
    expect(() => TimeRange.fromMilliseconds(2_000, 1_000)).toThrow(InvalidTimeRangeError);
  });

  it('refuse un intervalle qui commence avant le début du média', () => {
    expect(() => TimeRange.fromMilliseconds(-1, 1_000)).toThrow(InvalidTimeRangeError);
  });

  it('refuse des bornes qui ne sont pas des millisecondes entières', () => {
    expect(() => TimeRange.fromMilliseconds(0.5, 1_000)).toThrow(InvalidTimeRangeError);
    expect(() => TimeRange.fromMilliseconds(0, Number.NaN)).toThrow(InvalidTimeRangeError);
  });

  it('expose un code d\'erreur stable', () => {
    expect(() => TimeRange.fromMilliseconds(5, 5)).toThrow(
      expect.objectContaining({ code: 'INVALID_TIME_RANGE' }),
    );
  });

  it('sait si un intervalle précède ou touche le suivant', () => {
    const first = TimeRange.fromMilliseconds(0, 1_000);
    const touching = TimeRange.fromMilliseconds(1_000, 2_000);
    const overlapping = TimeRange.fromMilliseconds(999, 2_000);

    expect(first.precedesOrTouches(touching)).toBe(true);
    expect(first.precedesOrTouches(overlapping)).toBe(false);
    expect(touching.precedesOrTouches(first)).toBe(false);
  });

  it('compare deux intervalles par valeur', () => {
    expect(
      TimeRange.fromMilliseconds(10, 20).equals(TimeRange.fromMilliseconds(10, 20)),
    ).toBe(true);
    expect(
      TimeRange.fromMilliseconds(10, 20).equals(TimeRange.fromMilliseconds(10, 21)),
    ).toBe(false);
  });
});
