import { createReadStream } from 'node:fs';
import { chmod, copyFile, mkdir, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';

import type { MediaStorage } from '../../application/ports/media-storage';

/** Répertoire du magasin : lisible et traversable par son seul propriétaire. */
const DIRECTORY_MODE = 0o700;
/** Fichier média : lisible et modifiable par son seul propriétaire. */
const FILE_MODE = 0o600;

/**
 * Une clé de stockage est opaque du point de vue de ce magasin : elle est produite par
 * l'application (un identifiant généré, jamais un nom fourni par l'utilisateur). On la
 * valide malgré tout, parce qu'elle traverse une frontière de confiance vers le système de
 * fichiers : un seul segment, alphanumérique, sans séparateur ni point initial, donc aucune
 * traversée (`..`, `/`, `C:\`, `\0`) représentable.
 */
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class InvalidStorageKeyError extends Error {
  readonly code = 'INVALID_STORAGE_KEY';

  constructor() {
    super('Clé de stockage invalide.');
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
      // Le fichier temporaire d'upload et le magasin peuvent vivre sur deux volumes
      // distincts (tmpfs vs volume monté) : `rename` échoue alors en EXDEV.
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
      // Supprimer un média déjà absent est le résultat attendu, pas une erreur.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private pathFor(key: string): string {
    if (!KEY_PATTERN.test(key) || key === '.' || key === '..') throw new InvalidStorageKeyError();
    const candidate = resolve(join(this.root, key));
    // Ceinture et bretelles : même si le motif rendait une traversée impossible, on refuse
    // tout chemin qui sortirait du magasin.
    if (!isAbsolute(candidate) || !candidate.startsWith(this.root + sep)) {
      throw new InvalidStorageKeyError();
    }
    return candidate;
  }
}
