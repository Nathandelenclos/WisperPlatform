import { describe, expect, it } from 'vitest';

import { InvalidSpeakerError, InvalidSpeakerNameError } from './errors';
import { Speaker, SpeakerName } from './speaker';

describe('SpeakerName', () => {
  it('débarrasse le nom de ses espaces de bord', () => {
    expect(SpeakerName.of('  Marc  ').value).toBe('Marc');
  });

  it('refuse un nom vide après nettoyage', () => {
    expect(() => SpeakerName.of('   ')).toThrow(InvalidSpeakerNameError);
    expect(() => SpeakerName.of('')).toThrow(
      expect.objectContaining({ code: 'INVALID_SPEAKER_NAME' }),
    );
  });

  it('refuse un nom plus long que 60 caractères', () => {
    expect(SpeakerName.of('a'.repeat(60)).value).toHaveLength(60);
    expect(() => SpeakerName.of('a'.repeat(61))).toThrow(InvalidSpeakerNameError);
  });

  it('refuse un nom sur plusieurs lignes', () => {
    // Un nom finit dans un fichier de sous-titres, où une ligne est une unité de sens.
    expect(() => SpeakerName.of('Marc\nDupont')).toThrow(InvalidSpeakerNameError);
    expect(() => SpeakerName.of('Marc\r\nDupont')).toThrow(InvalidSpeakerNameError);
  });

  it('refuse les coupures de ligne et les caractères de contrôle que `\\n` ne couvre pas', () => {
    // Chacun est une nuisance réelle en aval : U+2028 et NEL coupent la ligne chez beaucoup
    // de lecteurs de sous-titres, le NUL tronque le libellé chez ceux écrits en C, et
    // U+202E inverse l'affichage du reste de la ligne.
    for (const forged of ['Marc\u2028Dupont', 'Marc\u0085Dupont', 'Marc\0', '\u202EMarc']) {
      expect(() => SpeakerName.of(forged)).toThrow(InvalidSpeakerNameError);
    }
    // Un vrai nom, lui, passe : accents, apostrophe, trait d'union.
    expect(SpeakerName.of('Marc-André O\u2019Brien').value).toBe('Marc-André O\u2019Brien');
  });

  it('relit un nom stocké sans le revalider', () => {
    // Un nom écrit sous une règle plus large ne doit pas rendre son aggregate irrécupérable.
    expect(SpeakerName.restored('a'.repeat(80)).value).toHaveLength(80);
  });
});

describe('Speaker', () => {
  it('naît sans nom, avec l\'indice du clustering', () => {
    const speaker = Speaker.discovered(2);

    expect(speaker.index).toBe(2);
    expect(speaker.name).toBeNull();
    expect(speaker.state()).toEqual({ index: 2, name: null });
  });

  it('refuse un indice qui n\'est pas un entier positif ou nul', () => {
    expect(() => Speaker.discovered(-1)).toThrow(InvalidSpeakerError);
    expect(() => Speaker.discovered(1.5)).toThrow(
      expect.objectContaining({ code: 'INVALID_SPEAKER' }),
    );
  });

  it('compte les locuteurs sans nom à partir de 1, là où le clustering compte à partir de 0', () => {
    expect(Speaker.discovered(0).label).toBe('Locuteur 1');
    expect(Speaker.discovered(4).label).toBe('Locuteur 5');
  });

  it('produit une nouvelle instance nommée sans toucher à l\'originale', () => {
    const original = Speaker.discovered(0);

    const named = original.withName(SpeakerName.of('Marc'));

    expect(named.label).toBe('Marc');
    expect(named.state()).toEqual({ index: 0, name: 'Marc' });
    expect(original.name).toBeNull();
  });

  it('fait l\'aller-retour entre état et instance sans rien perdre', () => {
    for (const state of [
      { index: 0, name: null },
      { index: 3, name: 'Marc' },
    ]) {
      expect(Speaker.restore(state).state()).toEqual(state);
    }
  });
});
