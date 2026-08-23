import { InvalidMediaError } from './errors';

/** Control characters: banned from a displayed name or from an HTTP header. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;
const MAX_ORIGINAL_NAME_LENGTH = 255;

/**
 * The original name only serves display and export: it is never a path.
 * We reduce it to its basename, strip the control characters, then truncate.
 * Normalization is idempotent: an already normalized name goes through `stored` unchanged,
 * which guarantees the full `restore` → `state` round trip.
 */
function normalizeOriginalName(raw: string): string {
  const printable = raw.replace(CONTROL_CHARACTERS, '');
  const lastSeparator = Math.max(printable.lastIndexOf('/'), printable.lastIndexOf('\\'));
  const basename = lastSeparator === -1 ? printable : printable.slice(lastSeparator + 1);
  return basename.slice(0, MAX_ORIGINAL_NAME_LENGTH).trim();
}

/** The media uploaded by the user, once filed away in the store. */
export class MediaAsset {
  private constructor(
    readonly storageKey: string,
    readonly originalName: string,
    readonly contentType: string,
    readonly byteSize: number,
  ) {
    Object.freeze(this);
  }

  static stored(p: {
    storageKey: string;
    originalName: string;
    contentType: string;
    byteSize: number;
  }): MediaAsset {
    if (p.storageKey.trim().length === 0) {
      throw new InvalidMediaError('a stored media must carry a storage key');
    }
    if (p.contentType.trim().length === 0) {
      throw new InvalidMediaError('a media must declare its content type');
    }
    if (!Number.isInteger(p.byteSize) || p.byteSize <= 0) {
      throw new InvalidMediaError('the size of a media must be a whole number of bytes');
    }
    const originalName = normalizeOriginalName(p.originalName);
    if (originalName.length === 0) {
      throw new InvalidMediaError('the media name is empty once cleaned up');
    }
    return new MediaAsset(p.storageKey, originalName, p.contentType, p.byteSize);
  }
}
