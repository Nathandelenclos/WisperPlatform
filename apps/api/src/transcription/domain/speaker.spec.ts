import { describe, expect, it } from 'vitest';

import { InvalidSpeakerError, InvalidSpeakerNameError } from './errors';
import { Speaker, SpeakerName } from './speaker';

describe('SpeakerName', () => {
  it('strips the name of its surrounding whitespace', () => {
    expect(SpeakerName.of('  Marc  ').value).toBe('Marc');
  });

  it('rejects a name that is empty after trimming', () => {
    expect(() => SpeakerName.of('   ')).toThrow(InvalidSpeakerNameError);
    expect(() => SpeakerName.of('')).toThrow(
      expect.objectContaining({ code: 'INVALID_SPEAKER_NAME' }),
    );
  });

  it('rejects a name longer than 60 characters', () => {
    expect(SpeakerName.of('a'.repeat(60)).value).toHaveLength(60);
    expect(() => SpeakerName.of('a'.repeat(61))).toThrow(InvalidSpeakerNameError);
  });

  it('rejects a name spanning several lines', () => {
    // A name ends up in a subtitle file, where a line is a unit of meaning.
    expect(() => SpeakerName.of('Marc\nDupont')).toThrow(InvalidSpeakerNameError);
    expect(() => SpeakerName.of('Marc\r\nDupont')).toThrow(InvalidSpeakerNameError);
  });

  it('rejects the line breaks and control characters that `\\n` does not cover', () => {
    // Each one is a real nuisance downstream: U+2028 and NEL cut the line in many subtitle
    // players, the NUL truncates the label in those written in C, and U+202E reverses the
    // display of the rest of the line.
    for (const forged of ['Marc\u2028Dupont', 'Marc\u0085Dupont', 'Marc\0', '\u202EMarc']) {
      expect(() => SpeakerName.of(forged)).toThrow(InvalidSpeakerNameError);
    }
    // A real name, though, gets through: accents, apostrophe, hyphen.
    expect(SpeakerName.of('Marc-André O\u2019Brien').value).toBe('Marc-André O\u2019Brien');
  });

  it('reads a stored name back without revalidating it', () => {
    // A name written under a broader rule must not make its aggregate unrecoverable.
    expect(SpeakerName.restored('a'.repeat(80)).value).toHaveLength(80);
  });
});

describe('Speaker', () => {
  it('is born without a name, with the index from the clustering', () => {
    const speaker = Speaker.discovered(2);

    expect(speaker.index).toBe(2);
    expect(speaker.name).toBeNull();
    expect(speaker.state()).toEqual({ index: 2, name: null });
  });

  it('rejects an index that is not a non-negative integer', () => {
    expect(() => Speaker.discovered(-1)).toThrow(InvalidSpeakerError);
    expect(() => Speaker.discovered(1.5)).toThrow(
      expect.objectContaining({ code: 'INVALID_SPEAKER' }),
    );
  });

  it('numbers unnamed speakers from 1, where the clustering counts from 0', () => {
    expect(Speaker.discovered(0).label).toBe('Speaker 1');
    expect(Speaker.discovered(4).label).toBe('Speaker 5');
  });

  it('produces a new named instance without touching the original', () => {
    const original = Speaker.discovered(0);

    const named = original.withName(SpeakerName.of('Marc'));

    expect(named.label).toBe('Marc');
    expect(named.state()).toEqual({ index: 0, name: 'Marc' });
    expect(original.name).toBeNull();
  });

  it('round-trips between state and instance without losing anything', () => {
    for (const state of [
      { index: 0, name: null },
      { index: 3, name: 'Marc' },
    ]) {
      expect(Speaker.restore(state).state()).toEqual(state);
    }
  });
});
