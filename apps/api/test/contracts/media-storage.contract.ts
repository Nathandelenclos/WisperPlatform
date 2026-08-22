import { describe, expect, it, afterEach } from 'vitest';

import type { MediaStorage } from '../../src/transcription/application/ports/media-storage';

/**
 * Bac d'essai d'un adaptateur de magasin. `stage` joue le dépôt du fichier temporaire par
 * l'upload : c'est la seule opération que le port n'expose pas, puisqu'elle est faite par le
 * transport avant d'appeler `adopt`.
 */
export type MediaStorageHarness = {
  readonly storage: MediaStorage;
  stage(tempPath: string, content: string): Promise<void>;
  /** Chemin temporaire libre, propre à cet adaptateur. */
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
 * Contrat du port `MediaStorage`, rejoué à l'identique sur le double et sur l'adaptateur réel :
 * c'est ce qui rend les scénarios d'acceptation transposables à la production.
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

    it('rend les octets qu\'on lui a confiés', async () => {
      const { storage, stage, tempPath } = await open();
      const source = tempPath('upload-1');
      await stage(source, 'des octets de média');

      await storage.adopt({ key: 'media-1', tempPath: source });

      expect(await readAll(await storage.openRead('media-1'))).toBe('des octets de média');
    });

    it('échoue à relire un média qu\'il ne détient pas', async () => {
      const { storage } = await open();

      // La lecture doit échouer, que l'adaptateur refuse à l'ouverture (en mémoire) ou à la
      // consommation du flux (système de fichiers) : l'appelant, lui, voit un rejet.
      await expect(
        storage.openRead('media-absent').then((stream) => readAll(stream)),
      ).rejects.toThrow();
    });

    it('ne détient plus rien après une suppression', async () => {
      const { storage, stage, tempPath } = await open();
      const source = tempPath('upload-2');
      await stage(source, 'à jeter');
      await storage.adopt({ key: 'media-2', tempPath: source });

      await storage.remove('media-2');

      await expect(
        storage.openRead('media-2').then((stream) => readAll(stream)),
      ).rejects.toThrow();
    });

    it('tolère de supprimer deux fois le même média', async () => {
      const { storage, stage, tempPath } = await open();
      const source = tempPath('upload-3');
      await stage(source, 'à jeter deux fois');
      await storage.adopt({ key: 'media-3', tempPath: source });

      await storage.remove('media-3');

      // Un worker qui rejoue sa fin de job ne doit pas provoquer d'erreur.
      await expect(storage.remove('media-3')).resolves.toBeUndefined();
    });

    it('remplace le contenu quand la même clé est réadoptée', async () => {
      const { storage, stage, tempPath } = await open();
      const first = tempPath('upload-4a');
      const second = tempPath('upload-4b');
      await stage(first, 'première version');
      await stage(second, 'seconde version');
      await storage.adopt({ key: 'media-4', tempPath: first });

      await storage.adopt({ key: 'media-4', tempPath: second });

      expect(await readAll(await storage.openRead('media-4'))).toBe('seconde version');
    });
  });
}
