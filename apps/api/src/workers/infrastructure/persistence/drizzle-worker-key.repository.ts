import { desc, eq } from 'drizzle-orm';

import type { Database } from '../../../shared/infrastructure/persistence/database';
import { workerKeys } from '../../../shared/infrastructure/persistence/schema';
import type { WorkerKeyRepository } from '../../application/ports/worker-key-repository';
import { WorkerKey, type WorkerKeyState } from '../../domain/worker-key';

type WorkerKeyRow = typeof workerKeys.$inferSelect;

/**
 * Translation between aggregate state ↔ columns. This mapping lives here and nowhere else:
 * the domain has no idea a database exists.
 */
export class DrizzleWorkerKeyRepository implements WorkerKeyRepository {
  constructor(private readonly db: Database) {}

  /**
   * A single write for creation as for update: a key fits in one row.
   *
   * ponytail: last write wins, with no optimistic lock. The only possible concurrent writes
   * touch `last_seen_at` (two workers of the same owner) and `revoked_at` (idempotent): losing
   * one second of freshness on a timestamp costs nothing. A `version` column would be the way
   * out if the key ever carried state that decides something.
   */
  async save(key: WorkerKey): Promise<void> {
    const state = key.state();
    await this.db
      .insert(workerKeys)
      .values(state)
      .onConflictDoUpdate({
        target: workerKeys.id,
        set: {
          label: state.label,
          lastSeenAt: state.lastSeenAt,
          revokedAt: state.revokedAt,
        },
      });
  }

  async findById(id: string): Promise<WorkerKey | null> {
    const [row] = await this.db.select().from(workerKeys).where(eq(workerKeys.id, id));
    return row === undefined ? null : WorkerKey.restore(toState(row));
  }

  async findBySecretFingerprint(fingerprint: string): Promise<WorkerKey | null> {
    const [row] = await this.db
      .select()
      .from(workerKeys)
      .where(eq(workerKeys.secretFingerprint, fingerprint));
    return row === undefined ? null : WorkerKey.restore(toState(row));
  }

  async listOwnedBy(ownerId: string): Promise<WorkerKey[]> {
    const rows = await this.db
      .select()
      .from(workerKeys)
      .where(eq(workerKeys.ownerId, ownerId))
      .orderBy(desc(workerKeys.createdAt));
    return rows.map((row) => WorkerKey.restore(toState(row)));
  }
}

function toState(row: WorkerKeyRow): WorkerKeyState {
  return {
    id: row.id,
    ownerId: row.ownerId,
    label: row.label,
    secretFingerprint: row.secretFingerprint,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    revokedAt: row.revokedAt,
  };
}
