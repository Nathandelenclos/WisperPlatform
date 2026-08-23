import { desc, eq } from 'drizzle-orm';

import type { Database } from '../../../shared/infrastructure/persistence/database';
import { workerKeys } from '../../../shared/infrastructure/persistence/schema';
import type { WorkerKeyRepository } from '../../application/ports/worker-key-repository';
import { WorkerKey, type WorkerKeyState } from '../../domain/worker-key';

type WorkerKeyRow = typeof workerKeys.$inferSelect;

/**
 * Traduction état de l'aggregate ↔ colonnes. Ce mapping vit ici et nulle part ailleurs :
 * le domaine ignore qu'une base existe.
 */
export class DrizzleWorkerKeyRepository implements WorkerKeyRepository {
  constructor(private readonly db: Database) {}

  /**
   * Écriture unique pour la création comme pour la mise à jour : une clé tient dans une ligne.
   *
   * ponytail: dernière écriture gagnante, sans verrou optimiste. Les seules écritures
   * concurrentes possibles portent sur `last_seen_at` (deux workers du même propriétaire) et
   * sur `revoked_at` (idempotent) : perdre une seconde de fraîcheur sur un horodatage ne coûte
   * rien. Une colonne `version` serait la sortie si la clé portait un jour un état qui décide.
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
