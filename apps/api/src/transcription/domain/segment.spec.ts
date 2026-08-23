import { describe, expect, it } from 'vitest';

import { InvalidSegmentTextError, InvalidSpeakerError } from './errors';
import { Segment } from './segment';
import { TimeRange } from './time-range';

const range = TimeRange.fromMilliseconds(0, 2_000);

describe('Segment', () => {
  it('is born uncorrected, with a text stripped of its whitespace', () => {
    const segment = Segment.transcribed(1, range, '  bonjour à tous  ');

    expect(segment.ordinal).toBe(1);
    expect(segment.text).toBe('bonjour à tous');
    expect(segment.corrected).toBe(false);
    // Diarization is a separate pass: a segment is born without a speaker.
    expect(segment.speakerIndex).toBeNull();
    expect(segment.range.equals(range)).toBe(true);
  });

  it('rejects a text that is empty after trimming', () => {
    expect(() => Segment.transcribed(1, range, '   \n ')).toThrow(InvalidSegmentTextError);
    expect(() => Segment.transcribed(1, range, '')).toThrow(
      expect.objectContaining({ code: 'INVALID_SEGMENT_TEXT' }),
    );
  });

  it('produces a new corrected instance without touching the original', () => {
    const original = Segment.transcribed(3, range, 'bonjour');

    const corrected = original.withCorrectedText('  Bonjour !  ');

    expect(corrected.text).toBe('Bonjour !');
    expect(corrected.corrected).toBe(true);
    expect(corrected.ordinal).toBe(3);
    expect(corrected.range.equals(range)).toBe(true);
    expect(original.text).toBe('bonjour');
    expect(original.corrected).toBe(false);
  });

  it('rejects a correction that empties the text', () => {
    const segment = Segment.transcribed(1, range, 'bonjour');

    expect(() => segment.withCorrectedText('  ')).toThrow(InvalidSegmentTextError);
  });

  it('round-trips between state and instance without losing anything', () => {
    const state = {
      ordinal: 7,
      startMs: 1_000,
      endMs: 4_250,
      text: 'texte relu',
      corrected: true,
      speakerIndex: 2,
    };

    expect(Segment.restore(state).state()).toEqual(state);
  });

  it('keeps the assigned speaker when the text is corrected', () => {
    const segment = Segment.transcribed(1, range, 'bonjur').withSpeaker(1);

    expect(segment.withCorrectedText('bonjour').speakerIndex).toBe(1);
  });

  it('produces a new instance when the speaker changes, without touching the original', () => {
    const original = Segment.transcribed(1, range, 'bonjour').withSpeaker(0);

    const reassigned = original.withSpeaker(null);

    expect(reassigned.speakerIndex).toBeNull();
    expect(original.speakerIndex).toBe(0);
  });

  it('rejects a speaker index that is not a non-negative integer', () => {
    // This gate guarded nothing: an invalid index crossed the domain and made the rendering of
    // an export throw, when that rendering promises to render under all circumstances.
    const segment = Segment.transcribed(1, range, 'bonjour');

    expect(() => segment.withSpeaker(-1)).toThrow(InvalidSpeakerError);
    expect(() => segment.withSpeaker(1.5)).toThrow(InvalidSpeakerError);
  });
});
