import { describe, expect, it } from 'vitest';

import { Segment } from './segment';
import { renderSubtitles } from './subtitle-document';
import { TimeRange } from './time-range';

const segments = [
  Segment.transcribed(1, TimeRange.fromMilliseconds(0, 2_500), 'Bonjour à tous.'),
  Segment.transcribed(2, TimeRange.fromMilliseconds(2_500, 3_661_234), 'Et bienvenue.'),
];

describe('renderSubtitles', () => {
  it('rend un SRT numéroté à partir de 1, avec la virgule décimale', () => {
    expect(renderSubtitles(segments, 'srt')).toBe(
      '1\n' +
        '00:00:00,000 --> 00:00:02,500\n' +
        'Bonjour à tous.\n' +
        '\n' +
        '2\n' +
        '00:00:02,500 --> 01:01:01,234\n' +
        'Et bienvenue.\n',
    );
  });

  it('rend un WebVTT en-têté, avec le point décimal', () => {
    expect(renderSubtitles(segments, 'vtt')).toBe(
      'WEBVTT\n' +
        '\n' +
        '00:00:00.000 --> 00:00:02.500\n' +
        'Bonjour à tous.\n' +
        '\n' +
        '00:00:02.500 --> 01:01:01.234\n' +
        'Et bienvenue.\n',
    );
  });

  it('rend un texte brut, une ligne par segment', () => {
    expect(renderSubtitles(segments, 'txt')).toBe('Bonjour à tous.\nEt bienvenue.\n');
  });

  it('écrit toujours les heures sur deux chiffres', () => {
    const late = [
      Segment.transcribed(1, TimeRange.fromMilliseconds(9 * 3_600_000, 9 * 3_600_000 + 5), 'tard'),
    ];

    expect(renderSubtitles(late, 'srt')).toContain('09:00:00,000 --> 09:00:00,005');
  });

  it('rend un document vide quand il n\'y a aucun segment', () => {
    expect(renderSubtitles([], 'srt')).toBe('');
    expect(renderSubtitles([], 'txt')).toBe('');
    expect(renderSubtitles([], 'vtt')).toBe('WEBVTT\n\n');
  });
});
