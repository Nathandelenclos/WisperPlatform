import { describe, expect, it, afterEach } from 'vitest';

import type { MediaStorage } from '../../src/transcription/application/ports/media-storage';

/**
 * Test harness for a storage adapter. `stage` plays the upload dropping the temporary file:
 * it is the only operation the port does not expose, since the transport performs it before
 * calling `adopt`.
 */
export type MediaStorageHarness = {
  readonly storage: MediaStorage;
  stage(tempPath: string, content: string): Promise<void>;
  /** Free temporary path, specific to this adapter. */
  tempPath(name: string): string;
  cleanup(): Promise<void>;
};

async function readAll(stream: AsyncIterable<unknown>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Contract of the `MediaStorage` port, replayed identically on the double and on the real
 * adapter: this is what makes the acceptance scenarios transposable to production.
 */
export function describeMediaStorageContract(
  name: string,
  factory: () => Promise<MediaStorageHarness>,
): void {
  describe(`MediaStorage — ${name}`, () => {
    let harness: MediaStorageHarness | null = null;

    afterEach(async () => {
      await harness?.cleanup();
      harness = null;
    });

    async function open(): Promise<MediaStorageHarness> {
      harness = await factory();
      return harness;
    }

    it('returns the bytes it was entrusted with', async () => {
      const { storage, stage, tempPath } = await open();
      const source = tempPath('upload-1');
      await stage(source, 'some media bytes');

      await storage.adopt({ key: 'media-1', tempPath: source });

      expect(await readAll(await storage.openRead('media-1'))).toBe('some media bytes');
    });

    it('fails to read back a media it does not hold', async () => {
      const { storage } = await open();

      // The read must fail, whether the adapter refuses on open (in memory) or on consuming the
      // stream (file system): the caller sees a rejection either way.
      await expect(
        storage.openRead('media-absent').then((stream) => readAll(stream)),
      ).rejects.toThrow();
    });

    it('holds nothing any more after a removal', async () => {
      const { storage, stage, tempPath } = await open();
      const source = tempPath('upload-2');
      await stage(source, 'to be discarded');
      await storage.adopt({ key: 'media-2', tempPath: source });

      await storage.remove('media-2');

      await expect(
        storage.openRead('media-2').then((stream) => readAll(stream)),
      ).rejects.toThrow();
    });

    it('tolerates removing the same media twice', async () => {
      const { storage, stage, tempPath } = await open();
      const source = tempPath('upload-3');
      await stage(source, 'to be discarded twice');
      await storage.adopt({ key: 'media-3', tempPath: source });

      await storage.remove('media-3');

      // A worker replaying the end of its job must not cause an error.
      await expect(storage.remove('media-3')).resolves.toBeUndefined();
    });

    it('replaces the content when the same key is re-adopted', async () => {
      const { storage, stage, tempPath } = await open();
      const first = tempPath('upload-4a');
      const second = tempPath('upload-4b');
      await stage(first, 'first version');
      await stage(second, 'second version');
      await storage.adopt({ key: 'media-4', tempPath: first });

      await storage.adopt({ key: 'media-4', tempPath: second });

      expect(await readAll(await storage.openRead('media-4'))).toBe('second version');
    });
  });
}
