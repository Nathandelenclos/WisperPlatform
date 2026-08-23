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
  it('keeps the description of the stored media', () => {
    const media = MediaAsset.stored(valid);

    expect(media.storageKey).toBe(valid.storageKey);
    expect(media.originalName).toBe('entretien.mp3');
    expect(media.contentType).toBe('audio/mpeg');
    expect(media.byteSize).toBe(4_096);
  });

  it('reduces the original name to its basename', () => {
    expect(
      MediaAsset.stored({ ...valid, originalName: '../../etc/passwd' }).originalName,
    ).toBe('passwd');
    expect(
      MediaAsset.stored({ ...valid, originalName: 'C:\\Users\\moi\\son.wav' }).originalName,
    ).toBe('son.wav');
  });

  it('strips control characters and truncates at 255 characters', () => {
    const media = MediaAsset.stored({ ...valid, originalName: `a\nb\u0000c${'x'.repeat(300)}.mp3` });

    expect(media.originalName.length).toBe(255);
    expect(media.originalName.startsWith('abc')).toBe(true);
    expect(media.originalName).not.toContain('\n');
  });

  it('normalizes idempotently, so that the persistence round trip is stable', () => {
    // The truncation lands exactly on a space: without a trim after the cut, the second pass
    // would return a name different from the first.
    const once = MediaAsset.stored({ ...valid, originalName: `folder/${'y'.repeat(254)}  end.mp3` });
    const twice = MediaAsset.stored({ ...valid, originalName: once.originalName });

    expect(once.originalName).toBe('y'.repeat(254));
    expect(twice.originalName).toBe(once.originalName);
  });

  it('rejects a media with no key, no type or an absurd size', () => {
    expect(() => MediaAsset.stored({ ...valid, storageKey: ' ' })).toThrow(InvalidMediaError);
    expect(() => MediaAsset.stored({ ...valid, contentType: '' })).toThrow(InvalidMediaError);
    expect(() => MediaAsset.stored({ ...valid, byteSize: 0 })).toThrow(InvalidMediaError);
    expect(() => MediaAsset.stored({ ...valid, byteSize: -3 })).toThrow(InvalidMediaError);
    expect(() => MediaAsset.stored({ ...valid, byteSize: 1.5 })).toThrow(
      expect.objectContaining({ code: 'INVALID_MEDIA' }),
    );
  });

  it('rejects a name that is empty once cleaned up', () => {
    expect(() => MediaAsset.stored({ ...valid, originalName: 'folder/' })).toThrow(
      InvalidMediaError,
    );
  });
});
