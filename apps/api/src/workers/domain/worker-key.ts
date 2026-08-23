import { InvalidWorkerKeyLabelError } from './errors';

/** Serializable form of the machine key: the repository writes and reads back exactly this. */
export type WorkerKeyState = {
  id: string;
  ownerId: string;
  label: string;
  /**
   * SHA-256 fingerprint of the secret. The plaintext secret exists once only, in the creation
   * response: it is neither stored nor logged, and nobody can recover it afterwards.
   */
  secretFingerprint: string;
  createdAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
};

/** Beyond that, it is no longer a label: it is a note pasted into a label field. */
const MAX_LABEL_LENGTH = 60;

/**
 * Name the owner gives their machine, to recognize it in their list.
 * Immutable value object — it is displayed on one line, hence the refusal of anything multiline.
 */
export class WorkerKeyLabel {
  private constructor(readonly value: string) {
    Object.freeze(this);
  }

  static of(raw: string): WorkerKeyLabel {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidWorkerKeyLabelError('a machine label cannot be empty');
    }
    if (trimmed.length > MAX_LABEL_LENGTH) {
      throw new InvalidWorkerKeyLabelError(
        `a machine label does not exceed ${MAX_LABEL_LENGTH} characters`,
      );
    }
    // Same categories refused as for a speaker name: `\r\n` is not the only way to break a
    // line (U+2028, U+2029, NEL), a NUL truncates a label for readers written in C, and U+202E
    // reverses the display of the rest of the line.
    if (/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(trimmed)) {
      throw new InvalidWorkerKeyLabelError(
        'a machine label fits on a single line, with no control character',
      );
    }
    return new WorkerKeyLabel(trimmed);
  }

  /**
   * Faithful read-back from storage: no revalidation. A label written under a wider rule must
   * not make its key unrecoverable — hence unrevocable.
   */
  static restored(value: string): WorkerKeyLabel {
    return new WorkerKeyLabel(value);
  }
}

/**
 * Aggregate root of the `workers` context: the key a user pastes into the launch command of
 * their machine. It carries ownership (the only fact that matters to the queue), the trace of
 * the last time it was seen, and its revocation.
 */
export class WorkerKey {
  /** Instants copied on the way in as on the way out: the caller keeps no hold on them. */
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

  /** An active key is a key never revoked: it alone speaks for its owner. */
  get isActive(): boolean {
    return this.revokedAtInstant === null;
  }

  /** Last known sighting of the machine, copied. */
  get lastSeen(): Date | null {
    return this.lastSeenAtInstant === null ? null : new Date(this.lastSeenAtInstant);
  }

  /**
   * Idempotent revocation: the first decision is the only one that counts. Revoking twice does
   * not move the instant and does not throw — the user who clicks twice is not wrong.
   */
  revoke(at: Date): void {
    if (this.revokedAtInstant !== null) {
      return;
    }
    this.revokedAtInstant = new Date(at);
  }

  /** The machine gave a sign of life. No business consequence: it is a fact, not a decision. */
  noteSeen(at: Date): void {
    this.lastSeenAtInstant = new Date(at);
  }

  state(): WorkerKeyState {
    return {
      id: this.id,
      ownerId: this.ownerId,
      label: this.label.value,
      secretFingerprint: this.secretFingerprint,
      // `Date` is mutable: without a copy, a caller would move a revocation back in time
      // without going through a business method.
      createdAt: new Date(this.createdAtInstant),
      lastSeenAt: this.lastSeen,
      revokedAt: this.revokedAtInstant === null ? null : new Date(this.revokedAtInstant),
    };
  }
}
