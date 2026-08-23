import type { Readable } from 'node:stream';

/** Store of original media. The key is opaque: the received file name never reaches the disk. */
export interface MediaStorage {
  /** Files the freshly received file under its final key. */
  adopt(p: { key: string; tempPath: string }): Promise<void>;
  openRead(key: string): Promise<Readable>;
  remove(key: string): Promise<void>;
}

export const MEDIA_STORAGE = Symbol('MediaStorage');
