import { describe, expect, it } from 'vitest';

import { Segment } from './segment';
import { Speaker, SpeakerName } from './speaker';
import { renderSubtitles } from './subtitle-document';
import { TimeRange } from './time-range';

const segments = [
  Segment.transcribed(1, TimeRange.fromMilliseconds(0, 2_500), 'Bonjour à tous.'),
  Segment.transcribed(2, TimeRange.fromMilliseconds(2_500, 3_661_234), 'Et bienvenue.'),
];

/** Les mêmes segments, une fois la diarisation passée : deux voix qui alternent. */
const diarized = [segments[0].withSpeaker(0), segments[1].withSpeaker(1)];

describe('renderSubtitles', () => {
  it('rend un SRT numéroté à partir de 1, avec la virgule décimale', () => {
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

  it('rend un WebVTT en-têté, avec le point décimal', () => {
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

  it('rend un texte brut, une ligne par segment', () => {
    expect(renderSubtitles(segments, 'txt', [])).toBe('Bonjour à tous.\nEt bienvenue.\n');
  });

  it('écrit toujours les heures sur deux chiffres', () => {
    const late = [
      Segment.transcribed(1, TimeRange.fromMilliseconds(9 * 3_600_000, 9 * 3_600_000 + 5), 'tard'),
    ];

    expect(renderSubtitles(late, 'srt', [])).toContain('09:00:00,000 --> 09:00:00,005');
  });

  it('rend un document vide quand il n\'y a aucun segment', () => {
    expect(renderSubtitles([], 'srt', [])).toBe('');
    expect(renderSubtitles([], 'txt', [])).toBe('');
    expect(renderSubtitles([], 'vtt', [])).toBe('WEBVTT\n\n');
  });

  it('ne préfixe rien quand aucun locuteur n\'est connu', () => {
    // Une transcription sans diarisation rend exactement le document d'avant la diarisation.
    const speakers = [Speaker.discovered(0), Speaker.discovered(1)];

    expect(renderSubtitles(segments, 'srt', speakers)).toBe(renderSubtitles(segments, 'srt', []));
    expect(renderSubtitles(segments, 'vtt', speakers)).toBe(renderSubtitles(segments, 'vtt', []));
    expect(renderSubtitles(segments, 'txt', speakers)).toBe(renderSubtitles(segments, 'txt', []));
  });

  it('préfixe le SRT du nom du locuteur, « Locuteur N » à défaut', () => {
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
        'Locuteur 2 : Et bienvenue.\n',
    );
  });

  it('préfixe le texte brut de la même façon', () => {
    const speakers = [
      Speaker.discovered(0).withName(SpeakerName.of('Marc')),
      Speaker.discovered(1).withName(SpeakerName.of('Léa')),
    ];

    expect(renderSubtitles(diarized, 'txt', speakers)).toBe(
      'Marc : Bonjour à tous.\nLéa : Et bienvenue.\n',
    );
  });

  it('rend le locuteur en balise de voix WebVTT', () => {
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
        '<v Locuteur 2>Et bienvenue.\n',
    );
  });

  it('échappe le nom dans la balise de voix, qui se terminerait au premier chevron', () => {
    const speakers = [Speaker.discovered(0).withName(SpeakerName.of('Marc <M&A>'))];

    expect(renderSubtitles([diarized[0]], 'vtt', speakers)).toContain(
      '<v Marc &lt;M&amp;A&gt;>Bonjour à tous.',
    );
  });

  it('laisse sans préfixe un segment que la diarisation n\'a pas attribué', () => {
    const speakers = [Speaker.discovered(0).withName(SpeakerName.of('Marc'))];

    expect(renderSubtitles([diarized[0], segments[1]], 'txt', speakers)).toBe(
      'Marc : Bonjour à tous.\nEt bienvenue.\n',
    );
  });

  it('retombe sur le nom par défaut quand la liste des locuteurs ne porte pas l\'indice', () => {
    expect(renderSubtitles([diarized[1]], 'txt', [])).toBe('Locuteur 2 : Et bienvenue.\n');
  });
});
