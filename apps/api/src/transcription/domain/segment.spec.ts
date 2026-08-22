import { describe, expect, it } from 'vitest';

import { InvalidSegmentTextError } from './errors';
import { Segment } from './segment';
import { TimeRange } from './time-range';

const range = TimeRange.fromMilliseconds(0, 2_000);

describe('Segment', () => {
  it('naît non corrigé, avec un texte débarrassé de ses espaces', () => {
    const segment = Segment.transcribed(1, range, '  bonjour à tous  ');

    expect(segment.ordinal).toBe(1);
    expect(segment.text).toBe('bonjour à tous');
    expect(segment.corrected).toBe(false);
    // La diarisation est une passe distincte : un segment naît sans locuteur.
    expect(segment.speakerIndex).toBeNull();
    expect(segment.range.equals(range)).toBe(true);
  });

  it('refuse un texte vide après nettoyage', () => {
    expect(() => Segment.transcribed(1, range, '   \n ')).toThrow(InvalidSegmentTextError);
    expect(() => Segment.transcribed(1, range, '')).toThrow(
      expect.objectContaining({ code: 'INVALID_SEGMENT_TEXT' }),
    );
  });

  it('produit une nouvelle instance corrigée sans toucher à l\'originale', () => {
    const original = Segment.transcribed(3, range, 'bonjour');

    const corrected = original.withCorrectedText('  Bonjour !  ');

    expect(corrected.text).toBe('Bonjour !');
    expect(corrected.corrected).toBe(true);
    expect(corrected.ordinal).toBe(3);
    expect(corrected.range.equals(range)).toBe(true);
    expect(original.text).toBe('bonjour');
    expect(original.corrected).toBe(false);
  });

  it('refuse une correction qui vide le texte', () => {
    const segment = Segment.transcribed(1, range, 'bonjour');

    expect(() => segment.withCorrectedText('  ')).toThrow(InvalidSegmentTextError);
  });

  it('fait l\'aller-retour entre état et instance sans rien perdre', () => {
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

  it('garde le locuteur attribué quand le texte est corrigé', () => {
    const segment = Segment.transcribed(1, range, 'bonjur').withSpeaker(1);

    expect(segment.withCorrectedText('bonjour').speakerIndex).toBe(1);
  });

  it('produit une nouvelle instance quand le locuteur change, sans toucher à l\'originale', () => {
    const original = Segment.transcribed(1, range, 'bonjour').withSpeaker(0);

    const reassigned = original.withSpeaker(null);

    expect(reassigned.speakerIndex).toBeNull();
    expect(original.speakerIndex).toBe(0);
  });
});
