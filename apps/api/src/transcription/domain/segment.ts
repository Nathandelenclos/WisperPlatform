import { InvalidSegmentTextError } from './errors';
import { assertSpeakerIndex } from './speaker';
import { TimeRange } from './time-range';

/** Serializable form of a segment, as persisted and as exposed in the views. */
export type SegmentState = {
  ordinal: number;
  startMs: number;
  endMs: number;
  text: string;
  corrected: boolean;
  /** Speaker assigned by the diarization pass — `null` for as long as it has not happened. */
  speakerIndex: number | null;
};

/**
 * A transcription segment: a time range and the text spoken.
 * Immutable value object — a correction produces a new instance.
 */
export class Segment {
  private constructor(
    readonly ordinal: number,
    readonly range: TimeRange,
    readonly text: string,
    readonly corrected: boolean,
    readonly speakerIndex: number | null,
  ) {
    Object.freeze(this);
  }

  /**
   * Segment as produced by the transcription engine: never corrected at birth, and without a
   * speaker — diarization is a separate pass, which may never come.
   */
  static transcribed(ordinal: number, range: TimeRange, text: string): Segment {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      throw new InvalidSegmentTextError('the text of a segment cannot be empty');
    }
    return new Segment(ordinal, range, trimmed, false, null);
  }

  /** Faithful read-back from storage: no normalization, the state comes back as it was. */
  static restore(state: SegmentState): Segment {
    return new Segment(
      state.ordinal,
      TimeRange.fromMilliseconds(state.startMs, state.endMs),
      state.text,
      state.corrected,
      state.speakerIndex,
    );
  }

  withCorrectedText(text: string): Segment {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      throw new InvalidSegmentTextError('a correction cannot empty the text of a segment');
    }
    return new Segment(this.ordinal, this.range, trimmed, true, this.speakerIndex);
  }

  /** Assignment from the diarization pass — `null` when no turn overlaps the segment. */
  withSpeaker(speakerIndex: number | null): Segment {
    if (speakerIndex !== null) assertSpeakerIndex(speakerIndex);
    return new Segment(this.ordinal, this.range, this.text, this.corrected, speakerIndex);
  }

  state(): SegmentState {
    return {
      ordinal: this.ordinal,
      startMs: this.range.startMs,
      endMs: this.range.endMs,
      text: this.text,
      corrected: this.corrected,
      speakerIndex: this.speakerIndex,
    };
  }
}
