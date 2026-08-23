import type { WorkerKey } from '../../domain/worker-key';

/**
 * Repository of the `WorkerKey` aggregate. `save` writes the whole key: it fits in one row,
 * there is nothing to assemble.
 *
 * `findBySecretFingerprint` is the authentication path of a machine: it returns the key even
 * when revoked, because it is the domain — and it alone — that decides what a revocation
 * prevents.
 */
export interface WorkerKeyRepository {
  save(key: WorkerKey): Promise<void>;
  findById(id: string): Promise<WorkerKey | null>;
  findBySecretFingerprint(fingerprint: string): Promise<WorkerKey | null>;
  /** An owner's keys, from the most recent to the oldest, revoked ones included. */
  listOwnedBy(ownerId: string): Promise<WorkerKey[]>;
}

export const WORKER_KEY_REPOSITORY = Symbol('WorkerKeyRepository');
