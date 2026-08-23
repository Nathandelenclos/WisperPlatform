import type { TranscriptionState } from '../../src/transcription/domain/transcription';

/**
 * One row of the store: the aggregate state and the two technical queue columns
 * (`reserved_at`, `reserved_by`), exactly like the `transcriptions` table.
 */
type StoredRow = {
  state: TranscriptionState;
  reservedAt: Date | null;
  reservedBy: string | null;
  /** Optimistic lock, like the table's `version` column. */
  version: number;
};

function cloneState(state: TranscriptionState): TranscriptionState {
  return {
    ...state,
    leaseExpiresAt: state.leaseExpiresAt === null ? null : new Date(state.leaseExpiresAt),
    requestedAt: new Date(state.requestedAt),
    completedAt: state.completedAt === null ? null : new Date(state.completedAt),
    segments: state.segments.map((segment) => ({ ...segment })),
    speakers: state.speakers.map((speaker) => ({ ...speaker })),
  };
}

/**
 * Store shared by the three read/write doubles, as the table is by the three real adapters.
 * States are copied on the way in and on the way out: no test can mutate the store's memory
 * through accidental aliasing.
 */
export class InMemoryTranscriptionStore {
  private readonly byId = new Map<string, StoredRow>();

  /**
   * Writes the whole aggregate without touching the queue columns. `expectedVersion` carries the
   * optimistic lock: `null` for a creation, otherwise the version that was read. Returns the new
   * version, or `null` if another writer got in between.
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

  /** Current version of a row, so the repository knows what it read. */
  versionOf(id: string): number | null {
    return this.byId.get(id)?.version ?? null;
  }

  states(): TranscriptionState[] {
    return [...this.byId.values()].map((row) => cloneState(row.state));
  }

  /** Live rows, reserved for the doubles' internal use (the queue writes on them). */
  rows(): StoredRow[] {
    return [...this.byId.values()];
  }
}
