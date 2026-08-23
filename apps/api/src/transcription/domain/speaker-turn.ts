import { assertSpeakerIndex } from './speaker';
import { TimeRange } from './time-range';

/**
 * A speaker turn as diarization delivers it: a time range and the technical index of the
 * speaker talking during that range. Immutable value object.
 *
 * A turn is never persisted: it is an input of the assignment pass, and only its result —
 * the speaker each segment carries — belongs to the aggregate.
 */
export class SpeakerTurn {
  private constructor(
    readonly range: TimeRange,
    readonly speakerIndex: number,
  ) {
    Object.freeze(this);
  }

  static of(range: TimeRange, speakerIndex: number): SpeakerTurn {
    assertSpeakerIndex(speakerIndex);
    return new SpeakerTurn(range, speakerIndex);
  }
}

/**
 * Speaker of a time range: the one whose turns cover the largest share of its duration.
 * The turns of one and the same speaker add up — a segment cut in two by an interjection
 * goes back to whoever spoke the most, not to the last one in.
 *
 * Two intended properties: the order of the turns on input has no bearing, and the same
 * diarization always yields the same assignment. Hence the tie-break on equal overlap by the
 * smallest index — arbitrary, but fixed. No overlap at all: no speaker.
 */
export function dominantSpeaker(turns: readonly SpeakerTurn[], range: TimeRange): number | null {
  // ponytail: quadratic assignment — every segment crosses every turn. Known ceiling:
  // 10,000 turns (the bound of the HTTP schema) times the number of segments, computed in
  // a single tick. Tenable at the real volumes of a meeting; beyond that, sorting both
  // sequences by start and sweeping them jointly gives the same result in O(n+m).
  const overlapBySpeaker = new Map<number, number>();
  for (const turn of turns) {
    const overlapMs = turn.range.overlapMsWith(range);
    if (overlapMs === 0) continue;
    overlapBySpeaker.set(
      turn.speakerIndex,
      (overlapBySpeaker.get(turn.speakerIndex) ?? 0) + overlapMs,
    );
  }

  let dominant: number | null = null;
  let dominantOverlapMs = 0;
  for (const [speaker, overlapMs] of overlapBySpeaker) {
    const wins =
      dominant === null ||
      overlapMs > dominantOverlapMs ||
      (overlapMs === dominantOverlapMs && speaker < dominant);
    if (wins) {
      dominant = speaker;
      dominantOverlapMs = overlapMs;
    }
  }
  return dominant;
}

/** The speakers diarization discovered: distinct indices sorted in ascending order. */
export function distinctSpeakers(turns: readonly SpeakerTurn[]): number[] {
  return [...new Set(turns.map((turn) => turn.speakerIndex))].sort((a, b) => a - b);
}
