import { createReadStream } from 'node:fs';
import { chmod, copyFile, mkdir, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';

import type { MediaStorage } from '../../application/ports/media-storage';

/** Store directory: readable and traversable by its owner alone. */
const DIRECTORY_MODE = 0o700;
/** Media file: readable and writable by its owner alone. */
const FILE_MODE = 0o600;

/**
 * A storage key is opaque from this store's point of view: it is produced by the application
 * (a generated identifier, never a name supplied by the user). It is validated all the same,
 * because it crosses a trust boundary towards the file system: one single segment,
 * alphanumeric, with no separator and no leading dot, so no traversal (`..`, `/`, `C:\`, `\0`)
 * is representable.
 */
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class InvalidStorageKeyError extends Error {
  readonly code = 'INVALID_STORAGE_KEY';

  constructor() {
    super('Invalid storage key.');
    this.name = 'InvalidStorageKeyError';
  }
}

export class FilesystemMediaStorage implements MediaStorage {
  private readonly root: string;

  constructor(rootDirectory: string) {
    this.root = resolve(rootDirectory);
  }

  async adopt(p: { key: string; tempPath: string }): Promise<void> {
    const target = this.pathFor(p.key);
    await mkdir(this.root, { recursive: true, mode: DIRECTORY_MODE });
    try {
      await rename(p.tempPath, target);
    } catch (error) {
      // The upload temporary file and the store may live on two distinct volumes
      // (tmpfs vs mounted volume): `rename` then fails with EXDEV.
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      await copyFile(p.tempPath, target);
      await unlink(p.tempPath);
    }
    await chmod(target, FILE_MODE);
  }

  async openRead(key: string): Promise<Readable> {
    return createReadStream(this.pathFor(key));
  }

  async remove(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch (error) {
      // Removing a media file that is already gone is the expected outcome, not an error.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private pathFor(key: string): string {
    if (!KEY_PATTERN.test(key) || key === '.' || key === '..') throw new InvalidStorageKeyError();
    const candidate = resolve(join(this.root, key));
    // Belt and braces: even if the pattern made a traversal impossible, any path that would
    // step outside the store is refused.
    if (!isAbsolute(candidate) || !candidate.startsWith(this.root + sep)) {
      throw new InvalidStorageKeyError();
    }
    return candidate;
  }
}
