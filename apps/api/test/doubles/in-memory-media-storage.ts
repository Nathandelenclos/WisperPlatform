import { Readable } from 'node:stream';

import type { MediaStorage } from '../../src/transcription/application/ports/media-storage';

/**
 * Magasin de médias en mémoire. `stage` joue le rôle du fichier temporaire déposé par
 * l'upload : `adopt` refuse une clé dont personne n'a déposé le contenu, ce qui attrape
 * les câblages où le fichier reçu n'arrive jamais au magasin.
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
      throw new Error(`aucun fichier temporaire déposé sous ${p.tempPath}`);
    }
    this.staged.delete(p.tempPath);
    this.kept.set(p.key, content);
  }

  async openRead(key: string): Promise<Readable> {
    const content = this.kept.get(key);
    if (content === undefined) {
      throw new Error('média absent du magasin');
    }
    return Readable.from([content]);
  }

  async remove(key: string): Promise<void> {
    this.kept.delete(key);
  }

  /** Ce que le magasin conserve, pour les assertions de test. */
  contentOf(key: string): string | null {
    return this.kept.get(key) ?? null;
  }

  keptKeys(): string[] {
    return [...this.kept.keys()];
  }
}
