import type { Readable } from 'node:stream';

/** Magasin des médias d'origine. La clé est opaque : le nom du fichier reçu n'atteint jamais le disque. */
export interface MediaStorage {
  /** Range le fichier fraîchement reçu sous sa clé définitive. */
  adopt(p: { key: string; tempPath: string }): Promise<void>;
  openRead(key: string): Promise<Readable>;
  remove(key: string): Promise<void>;
}

export const MEDIA_STORAGE = Symbol('MediaStorage');
