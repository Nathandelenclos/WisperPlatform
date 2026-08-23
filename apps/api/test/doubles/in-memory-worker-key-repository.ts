import type { WorkerKeyRepository } from '../../src/workers/application/ports/worker-key-repository';
import { WorkerKey, type WorkerKeyState } from '../../src/workers/domain/worker-key';

/**
 * In-memory repository of machine keys. States are copied on the way in and on the way out: no
 * test can mutate the store's memory through accidental aliasing, exactly like a database.
 */
export class InMemoryWorkerKeyRepository implements WorkerKeyRepository {
  private readonly byId = new Map<string, WorkerKeyState>();

  async save(key: WorkerKey): Promise<void> {
    const state = key.state();
    this.byId.set(state.id, clone(state));
  }

  async findById(id: string): Promise<WorkerKey | null> {
    const state = this.byId.get(id);
    return state === undefined ? null : WorkerKey.restore(clone(state));
  }

  async findBySecretFingerprint(fingerprint: string): Promise<WorkerKey | null> {
    const state = [...this.byId.values()].find(
      (candidate) => candidate.secretFingerprint === fingerprint,
    );
    return state === undefined ? null : WorkerKey.restore(clone(state));
  }

  async listOwnedBy(ownerId: string): Promise<WorkerKey[]> {
    return [...this.byId.values()]
      .filter((state) => state.ownerId === ownerId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map((state) => WorkerKey.restore(clone(state)));
  }
}

function clone(state: WorkerKeyState): WorkerKeyState {
  return {
    ...state,
    createdAt: new Date(state.createdAt),
    lastSeenAt: state.lastSeenAt === null ? null : new Date(state.lastSeenAt),
    revokedAt: state.revokedAt === null ? null : new Date(state.revokedAt),
  };
}
