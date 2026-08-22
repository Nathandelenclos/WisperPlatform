import { describe, expect, it } from 'vitest';

import { InvalidMediaError } from './errors';
import { MediaAsset } from './media-asset';

const valid = {
  storageKey: '0f0e3a1c-0000-4000-8000-000000000001',
  originalName: 'entretien.mp3',
  contentType: 'audio/mpeg',
  byteSize: 4_096,
};

describe('MediaAsset', () => {
  it('retient la description du média rangé', () => {
    const media = MediaAsset.stored(valid);

    expect(media.storageKey).toBe(valid.storageKey);
    expect(media.originalName).toBe('entretien.mp3');
    expect(media.contentType).toBe('audio/mpeg');
    expect(media.byteSize).toBe(4_096);
  });

  it('ramène le nom d\'origine à son basename', () => {
    expect(
      MediaAsset.stored({ ...valid, originalName: '../../etc/passwd' }).originalName,
    ).toBe('passwd');
    expect(
      MediaAsset.stored({ ...valid, originalName: 'C:\\Users\\moi\\son.wav' }).originalName,
    ).toBe('son.wav');
  });

  it('retire les caractères de contrôle et tronque à 255 caractères', () => {
    const media = MediaAsset.stored({ ...valid, originalName: `a\nb\u0000c${'x'.repeat(300)}.mp3` });

    expect(media.originalName.length).toBe(255);
    expect(media.originalName.startsWith('abc')).toBe(true);
    expect(media.originalName).not.toContain('\n');
  });

  it('normalise de façon idempotente, pour que l\'aller-retour de persistance soit stable', () => {
    // La troncature tombe pile sur une espace : sans nettoyage après coupe, le second passage
    // rendrait un nom différent du premier.
    const once = MediaAsset.stored({ ...valid, originalName: `dossier/${'y'.repeat(254)}  fin.mp3` });
    const twice = MediaAsset.stored({ ...valid, originalName: once.originalName });

    expect(once.originalName).toBe('y'.repeat(254));
    expect(twice.originalName).toBe(once.originalName);
  });

  it('refuse un média sans clé, sans type ou de taille absurde', () => {
    expect(() => MediaAsset.stored({ ...valid, storageKey: ' ' })).toThrow(InvalidMediaError);
    expect(() => MediaAsset.stored({ ...valid, contentType: '' })).toThrow(InvalidMediaError);
    expect(() => MediaAsset.stored({ ...valid, byteSize: 0 })).toThrow(InvalidMediaError);
    expect(() => MediaAsset.stored({ ...valid, byteSize: -3 })).toThrow(InvalidMediaError);
    expect(() => MediaAsset.stored({ ...valid, byteSize: 1.5 })).toThrow(
      expect.objectContaining({ code: 'INVALID_MEDIA' }),
    );
  });

  it('refuse un nom vide une fois nettoyé', () => {
    expect(() => MediaAsset.stored({ ...valid, originalName: 'dossier/' })).toThrow(
      InvalidMediaError,
    );
  });
});
