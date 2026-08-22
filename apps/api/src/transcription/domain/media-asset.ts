import { InvalidMediaError } from './errors';

/** Caractères de contrôle : bannis d'un nom affiché ou d'un en-tête HTTP. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;
const MAX_ORIGINAL_NAME_LENGTH = 255;

/**
 * Le nom d'origine ne sert qu'à l'affichage et à l'export : il n'est jamais un chemin.
 * On le ramène à son basename, on retire les caractères de contrôle puis on tronque.
 * La normalisation est idempotente : un nom déjà normalisé traverse `stored` inchangé,
 * ce qui garantit le tour complet `restore` → `state`.
 */
function normalizeOriginalName(raw: string): string {
  const printable = raw.replace(CONTROL_CHARACTERS, '');
  const lastSeparator = Math.max(printable.lastIndexOf('/'), printable.lastIndexOf('\\'));
  const basename = lastSeparator === -1 ? printable : printable.slice(lastSeparator + 1);
  return basename.slice(0, MAX_ORIGINAL_NAME_LENGTH).trim();
}

/** Le média déposé par l'utilisateur, une fois rangé dans le magasin. */
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
      throw new InvalidMediaError('un média rangé doit porter une clé de stockage');
    }
    if (p.contentType.trim().length === 0) {
      throw new InvalidMediaError('un média doit déclarer son type de contenu');
    }
    if (!Number.isInteger(p.byteSize) || p.byteSize <= 0) {
      throw new InvalidMediaError('la taille d\'un média doit être un nombre entier d\'octets');
    }
    const originalName = normalizeOriginalName(p.originalName);
    if (originalName.length === 0) {
      throw new InvalidMediaError('le nom du média est vide une fois nettoyé');
    }
    return new MediaAsset(p.storageKey, originalName, p.contentType, p.byteSize);
  }
}
