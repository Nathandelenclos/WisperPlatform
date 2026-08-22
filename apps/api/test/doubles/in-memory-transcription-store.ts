import type { TranscriptionState } from '../../src/transcription/domain/transcription';

/**
 * Une ligne du magasin : l'état de l'aggregate et les deux colonnes techniques de file
 * (`reserved_at`, `reserved_by`), exactement comme la table `transcriptions`.
 */
type StoredRow = {
  state: TranscriptionState;
  reservedAt: Date | null;
  reservedBy: string | null;
  /** Verrou optimiste, comme la colonne `version` de la table. */
  version: number;
};

function cloneState(state: TranscriptionState): TranscriptionState {
  return {
    ...state,
    leaseExpiresAt: state.leaseExpiresAt === null ? null : new Date(state.leaseExpiresAt),
    requestedAt: new Date(state.requestedAt),
    completedAt: state.completedAt === null ? null : new Date(state.completedAt),
    segments: state.segments.map((segment) => ({ ...segment })),
  };
}

/**
 * Magasin partagé par les trois doubles de lecture/écriture, comme la table l'est par les trois
 * adaptateurs réels. Les états entrent et sortent copiés : aucun test ne peut muter la mémoire
 * du magasin par un aliasing accidentel.
 */
export class InMemoryTranscriptionStore {
  private readonly byId = new Map<string, StoredRow>();

  /**
   * Écrit l'aggregate entier sans toucher aux colonnes de file. `expectedVersion` porte le
   * verrou optimiste : `null` pour une création, sinon la version lue. Rend la nouvelle
   * version, ou `null` si un autre écrivain est passé entre-temps.
   */
  write(state: TranscriptionState, expectedVersion: number | null): number | null {
    const existing = this.byId.get(state.id);
    if (expectedVersion === null) {
      if (existing !== undefined) return null;
    } else if (existing === undefined || existing.version !== expectedVersion) {
      return null;
    }
    const version = (expectedVersion ?? 0) + 1;
    this.byId.set(state.id, {
      state: cloneState(state),
      reservedAt: existing?.reservedAt ?? null,
      reservedBy: existing?.reservedBy ?? null,
      version,
    });
    return version;
  }

  read(id: string): TranscriptionState | null {
    const row = this.byId.get(id);
    return row === undefined ? null : cloneState(row.state);
  }

  /** Version courante d'une ligne, pour que le dépôt sache ce qu'il a lu. */
  versionOf(id: string): number | null {
    return this.byId.get(id)?.version ?? null;
  }

  states(): TranscriptionState[] {
    return [...this.byId.values()].map((row) => cloneState(row.state));
  }

  /** Lignes vivantes, réservées à l'usage interne des doubles (la file écrit dessus). */
  rows(): StoredRow[] {
    return [...this.byId.values()];
  }
}
