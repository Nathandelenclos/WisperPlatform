import { InvalidTimeRangeError } from './errors';

/**
 * Time range of a segment, expressed in whole milliseconds since the start of the media.
 * Immutable value object: validated at construction, no mutation possible.
 */
export class TimeRange {
  private constructor(
    readonly startMs: number,
    readonly endMs: number,
  ) {
    Object.freeze(this);
  }

  static fromMilliseconds(startMs: number, endMs: number): TimeRange {
    if (!Number.isInteger(startMs) || !Number.isInteger(endMs)) {
      throw new InvalidTimeRangeError(
        'the bounds of a time range must be whole milliseconds',
      );
    }
    if (startMs < 0) {
      throw new InvalidTimeRangeError('a time range cannot begin before the start of the media');
    }
    if (startMs >= endMs) {
      throw new InvalidTimeRangeError('a time range must end after its start');
    }
    return new TimeRange(startMs, endMs);
  }

  /** True if this range ends before, or exactly at the start of, the other one. */
  precedesOrTouches(other: TimeRange): boolean {
    return this.endMs <= other.startMs;
  }

  /**
   * Duration common to both ranges, in milliseconds — 0 when they do not cross.
   * This is the measure the assignment of a speaker to a segment rests on.
   */
  overlapMsWith(other: TimeRange): number {
    return Math.max(0, Math.min(this.endMs, other.endMs) - Math.max(this.startMs, other.startMs));
  }

  equals(other: TimeRange): boolean {
    return this.startMs === other.startMs && this.endMs === other.endMs;
  }
}
