import { InvalidWorkerKeyLabelError } from './errors';

/** Forme sérialisable de la clé de machine : le dépôt écrit et relit exactement ceci. */
export type WorkerKeyState = {
  id: string;
  ownerId: string;
  label: string;
  /**
   * Empreinte SHA-256 du secret. Le secret en clair n'existe qu'une fois, dans la réponse de
   * création : il n'est ni stocké ni journalisé, et personne ne peut le retrouver ensuite.
   */
  secretFingerprint: string;
  createdAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
};

/** Au-delà, ce n'est plus un libellé : c'est une note collée dans un champ de libellé. */
const MAX_LABEL_LENGTH = 60;

/**
 * Nom que le propriétaire donne à sa machine, pour la reconnaître dans sa liste.
 * Value object immuable ; il s'affiche sur une ligne, d'où le refus du multiligne.
 */
export class WorkerKeyLabel {
  private constructor(readonly value: string) {
    Object.freeze(this);
  }

  static of(raw: string): WorkerKeyLabel {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidWorkerKeyLabelError('le libellé d\'une machine ne peut pas être vide');
    }
    if (trimmed.length > MAX_LABEL_LENGTH) {
      throw new InvalidWorkerKeyLabelError(
        `le libellé d'une machine ne dépasse pas ${MAX_LABEL_LENGTH} caractères`,
      );
    }
    // Mêmes catégories refusées que pour le nom d'un locuteur : `\r\n` n'est pas la seule
    // façon de couper une ligne (U+2028, U+2029, NEL), un NUL tronque un libellé chez les
    // lecteurs écrits en C, et U+202E inverse l'affichage du reste de la ligne.
    if (/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(trimmed)) {
      throw new InvalidWorkerKeyLabelError(
        'le libellé d\'une machine tient sur une seule ligne, sans caractère de contrôle',
      );
    }
    return new WorkerKeyLabel(trimmed);
  }

  /**
   * Relecture fidèle depuis le stockage : aucune revalidation. Un libellé écrit sous une règle
   * plus large ne doit pas rendre sa clé irrécupérable — donc irrévocable.
   */
  static restored(value: string): WorkerKeyLabel {
    return new WorkerKeyLabel(value);
  }
}

/**
 * Aggregate root du contexte `workers` : la clé qu'un utilisateur colle dans la commande de
 * lancement de sa machine. Elle porte l'appartenance (le seul fait qui compte pour la file),
 * la trace du dernier passage, et sa révocation.
 */
export class WorkerKey {
  /** Instants recopiés à l'entrée comme à la sortie : l'appelant ne garde aucune prise. */
  private readonly createdAtInstant: Date;
  private lastSeenAtInstant: Date | null;
  private revokedAtInstant: Date | null;

  private constructor(
    readonly id: string,
    readonly ownerId: string,
    readonly label: WorkerKeyLabel,
    readonly secretFingerprint: string,
    createdAt: Date,
    lastSeenAt: Date | null,
    revokedAt: Date | null,
  ) {
    this.createdAtInstant = new Date(createdAt);
    this.lastSeenAtInstant = lastSeenAt === null ? null : new Date(lastSeenAt);
    this.revokedAtInstant = revokedAt === null ? null : new Date(revokedAt);
  }

  static issue(p: {
    id: string;
    ownerId: string;
    label: WorkerKeyLabel;
    secretFingerprint: string;
    createdAt: Date;
  }): WorkerKey {
    return new WorkerKey(
      p.id,
      p.ownerId,
      p.label,
      p.secretFingerprint,
      p.createdAt,
      null,
      null,
    );
  }

  static restore(state: WorkerKeyState): WorkerKey {
    return new WorkerKey(
      state.id,
      state.ownerId,
      WorkerKeyLabel.restored(state.label),
      state.secretFingerprint,
      state.createdAt,
      state.lastSeenAt,
      state.revokedAt,
    );
  }

  /** Une clé active est une clé jamais révoquée : c'est la seule qui parle pour son propriétaire. */
  get isActive(): boolean {
    return this.revokedAtInstant === null;
  }

  /** Dernier passage connu de la machine, copié. */
  get lastSeen(): Date | null {
    return this.lastSeenAtInstant === null ? null : new Date(this.lastSeenAtInstant);
  }

  /**
   * Révocation idempotente : la première décision est la seule qui compte. Révoquer deux fois
   * ne déplace pas l'instant et ne lève pas — l'utilisateur qui clique deux fois n'a pas tort.
   */
  revoke(at: Date): void {
    if (this.revokedAtInstant !== null) {
      return;
    }
    this.revokedAtInstant = new Date(at);
  }

  /** La machine a donné signe de vie. Sans conséquence métier : c'est un fait, pas une décision. */
  noteSeen(at: Date): void {
    this.lastSeenAtInstant = new Date(at);
  }

  state(): WorkerKeyState {
    return {
      id: this.id,
      ownerId: this.ownerId,
      label: this.label.value,
      secretFingerprint: this.secretFingerprint,
      // `Date` est mutable : sans copie, un appelant reculerait une révocation sans passer
      // par une méthode métier.
      createdAt: new Date(this.createdAtInstant),
      lastSeenAt: this.lastSeen,
      revokedAt: this.revokedAtInstant === null ? null : new Date(this.revokedAtInstant),
    };
  }
}
