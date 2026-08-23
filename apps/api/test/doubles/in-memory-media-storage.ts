import { Readable } from 'node:stream';

import type { MediaStorage } from '../../src/transcription/application/ports/media-storage';

/**
 * In-memory media store. `stage` plays the role of the temporary file dropped by the upload:
 * `adopt` refuses a key whose content nobody staged, which catches the wirings where the
 * received file never reaches the store.
 */
export class InMemoryMediaStorage implements MediaStorage {
  private readonly staged = new Map<string, string>();
  private readonly kept = new Map<string, string>();

  stage(tempPath: string, content: string): void {
    this.staged.set(tempPath, content);
  }

  async adopt(p: { key: string; tempPath: string }): Promise<void> {
    const content = this.staged.get(p.tempPath);
    if (content === undefined) {
      throw new Error(`no temporary file staged under ${p.tempPath}`);
    }
    this.staged.delete(p.tempPath);
    this.kept.set(p.key, content);
  }

  async openRead(key: string): Promise<Readable> {
    const content = this.kept.get(key);
    if (content === undefined) {
      throw new Error('media missing from the store');
    }
    return Readable.from([content]);
  }

  async remove(key: string): Promise<void> {
    this.kept.delete(key);
  }

  /** What the store keeps, for the test assertions. */
  contentOf(key: string): string | null {
    return this.kept.get(key) ?? null;
  }

  keptKeys(): string[] {
    return [...this.kept.keys()];
  }
}
