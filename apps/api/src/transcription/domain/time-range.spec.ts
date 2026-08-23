import { describe, expect, it } from 'vitest';

import { InvalidTimeRangeError } from './errors';
import { TimeRange } from './time-range';

describe('TimeRange', () => {
  it('keeps the bounds of a valid time range', () => {
    const range = TimeRange.fromMilliseconds(0, 1_500);

    expect(range.startMs).toBe(0);
    expect(range.endMs).toBe(1_500);
  });

  it('rejects a time range that does not move forward in time', () => {
    expect(() => TimeRange.fromMilliseconds(1_000, 1_000)).toThrow(InvalidTimeRangeError);
    expect(() => TimeRange.fromMilliseconds(2_000, 1_000)).toThrow(InvalidTimeRangeError);
  });

  it('rejects a time range that begins before the start of the media', () => {
    expect(() => TimeRange.fromMilliseconds(-1, 1_000)).toThrow(InvalidTimeRangeError);
  });

  it('rejects bounds that are not whole milliseconds', () => {
    expect(() => TimeRange.fromMilliseconds(0.5, 1_000)).toThrow(InvalidTimeRangeError);
    expect(() => TimeRange.fromMilliseconds(0, Number.NaN)).toThrow(InvalidTimeRangeError);
  });

  it('exposes a stable error code', () => {
    expect(() => TimeRange.fromMilliseconds(5, 5)).toThrow(
      expect.objectContaining({ code: 'INVALID_TIME_RANGE' }),
    );
  });

  it('knows whether a range precedes or touches the next one', () => {
    const first = TimeRange.fromMilliseconds(0, 1_000);
    const touching = TimeRange.fromMilliseconds(1_000, 2_000);
    const overlapping = TimeRange.fromMilliseconds(999, 2_000);

    expect(first.precedesOrTouches(touching)).toBe(true);
    expect(first.precedesOrTouches(overlapping)).toBe(false);
    expect(touching.precedesOrTouches(first)).toBe(false);
  });

  it('compares two time ranges by value', () => {
    expect(
      TimeRange.fromMilliseconds(10, 20).equals(TimeRange.fromMilliseconds(10, 20)),
    ).toBe(true);
    expect(
      TimeRange.fromMilliseconds(10, 20).equals(TimeRange.fromMilliseconds(10, 21)),
    ).toBe(false);
  });
});
