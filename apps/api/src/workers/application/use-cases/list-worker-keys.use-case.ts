import type { WorkerKeyRepository } from '../ports/worker-key-repository';
import { toWorkerKeyView, type WorkerKeyView } from '../views';

export type ListWorkerKeysQuery = { ownerId: string };

/** The machines declared by the owner, revoked ones included: this is their history. */
export class ListWorkerKeysUseCase {
  constructor(private readonly repository: WorkerKeyRepository) {}

  async execute(query: ListWorkerKeysQuery): Promise<WorkerKeyView[]> {
    const keys = await this.repository.listOwnedBy(query.ownerId);
    return keys.map((key) => toWorkerKeyView(key.state()));
  }
}
