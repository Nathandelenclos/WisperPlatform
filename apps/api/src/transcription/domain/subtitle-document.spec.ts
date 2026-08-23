import { describe, expect, it } from 'vitest';

import { Segment } from './segment';
import { Speaker, SpeakerName } from './speaker';
import { renderSubtitles } from './subtitle-document';
import { TimeRange } from './time-range';

const segments = [
  Segment.transcribed(1, TimeRange.fromMilliseconds(0, 2_500), 'Bonjour à tous.'),
  Segment.transcribed(2, TimeRange.fromMilliseconds(2_500, 3_661_234), 'Et bienvenue.'),
];

/** The same segments, once diarization has run: two voices taking turns. */
const diarized = [segments[0].withSpeaker(0), segments[1].withSpeaker(1)];

describe('renderSubtitles', () => {
  it('renders an SRT numbered from 1, with the decimal comma', () => {
    expect(renderSubtitles(segments, 'srt', [])).toBe(
      '1\n' +
        '00:00:00,000 --> 00:00:02,500\n' +
        'Bonjour à tous.\n' +
        '\n' +
        '2\n' +
        '00:00:02,500 --> 01:01:01,234\n' +
        'Et bienvenue.\n',
    );
  });

  it('renders a WebVTT with a header, with the decimal dot', () => {
    expect(renderSubtitles(segments, 'vtt', [])).toBe(
      'WEBVTT\n' +
        '\n' +
        '00:00:00.000 --> 00:00:02.500\n' +
        'Bonjour à tous.\n' +
        '\n' +
        '00:00:02.500 --> 01:01:01.234\n' +
        'Et bienvenue.\n',
    );
  });

  it('renders plain text, one line per segment', () => {
    expect(renderSubtitles(segments, 'txt', [])).toBe('Bonjour à tous.\nEt bienvenue.\n');
  });

  it('always writes the hours on two digits', () => {
    const late = [
      Segment.transcribed(1, TimeRange.fromMilliseconds(9 * 3_600_000, 9 * 3_600_000 + 5), 'tard'),
    ];

    expect(renderSubtitles(late, 'srt', [])).toContain('09:00:00,000 --> 09:00:00,005');
  });

  it('renders an empty document when there is no segment', () => {
    expect(renderSubtitles([], 'srt', [])).toBe('');
    expect(renderSubtitles([], 'txt', [])).toBe('');
    expect(renderSubtitles([], 'vtt', [])).toBe('WEBVTT\n\n');
  });

  it('prefixes nothing when no speaker is known', () => {
    // A transcription without diarization renders exactly the document from before diarization.
    const speakers = [Speaker.discovered(0), Speaker.discovered(1)];

    expect(renderSubtitles(segments, 'srt', speakers)).toBe(renderSubtitles(segments, 'srt', []));
    expect(renderSubtitles(segments, 'vtt', speakers)).toBe(renderSubtitles(segments, 'vtt', []));
    expect(renderSubtitles(segments, 'txt', speakers)).toBe(renderSubtitles(segments, 'txt', []));
  });

  it('prefixes the SRT with the speaker name, "Speaker N" by default', () => {
    const speakers = [
      Speaker.discovered(0).withName(SpeakerName.of('Marc')),
      Speaker.discovered(1),
    ];

    expect(renderSubtitles(diarized, 'srt', speakers)).toBe(
      '1\n' +
        '00:00:00,000 --> 00:00:02,500\n' +
        'Marc : Bonjour à tous.\n' +
        '\n' +
        '2\n' +
        '00:00:02,500 --> 01:01:01,234\n' +
        'Speaker 2 : Et bienvenue.\n',
    );
  });

  it('prefixes the plain text in the same way', () => {
    const speakers = [
      Speaker.discovered(0).withName(SpeakerName.of('Marc')),
      Speaker.discovered(1).withName(SpeakerName.of('Léa')),
    ];

    expect(renderSubtitles(diarized, 'txt', speakers)).toBe(
      'Marc : Bonjour à tous.\nLéa : Et bienvenue.\n',
    );
  });

  it('renders the speaker as a WebVTT voice tag', () => {
    const speakers = [
      Speaker.discovered(0).withName(SpeakerName.of('Marc')),
      Speaker.discovered(1),
    ];

    expect(renderSubtitles(diarized, 'vtt', speakers)).toBe(
      'WEBVTT\n' +
        '\n' +
        '00:00:00.000 --> 00:00:02.500\n' +
        '<v Marc>Bonjour à tous.\n' +
        '\n' +
        '00:00:02.500 --> 01:01:01.234\n' +
        '<v Speaker 2>Et bienvenue.\n',
    );
  });

  it('escapes the name inside the voice tag, which would end at the first angle bracket', () => {
    const speakers = [Speaker.discovered(0).withName(SpeakerName.of('Marc <M&A>'))];

    expect(renderSubtitles([diarized[0]], 'vtt', speakers)).toContain(
      '<v Marc &lt;M&amp;A&gt;>Bonjour à tous.',
    );
  });

  it('escapes the segment text too, which shares the line with the tag', () => {
    // The text is correctable by the owner: a correction containing `</v>` must not interact
    // with the markup we have just introduced in this format.
    const forged = Segment.transcribed(1, TimeRange.fromMilliseconds(0, 1_000), '</v>fin & <i>');

    expect(renderSubtitles([forged], 'vtt', [])).toContain('&lt;/v&gt;fin &amp; &lt;i&gt;');
    // SRT and plain text carry no markup: the text stays there just as it was written.
    expect(renderSubtitles([forged], 'srt', [])).toContain('</v>fin & <i>');
    expect(renderSubtitles([forged], 'txt', [])).toBe('</v>fin & <i>\n');
  });

  it('leaves unprefixed a segment that diarization did not assign', () => {
    const speakers = [Speaker.discovered(0).withName(SpeakerName.of('Marc'))];

    expect(renderSubtitles([diarized[0], segments[1]], 'txt', speakers)).toBe(
      'Marc : Bonjour à tous.\nEt bienvenue.\n',
    );
  });

  it('falls back on the default name when the speaker list does not carry the index', () => {
    expect(renderSubtitles([diarized[1]], 'txt', [])).toBe('Speaker 2 : Et bienvenue.\n');
  });
});
