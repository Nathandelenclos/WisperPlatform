import type { WorkerKeyRepository } from '../ports/worker-key-repository';
import { toWorkerKeyView, type WorkerKeyView } from '../views';

export type ListWorkerKeysQuery = { ownerId: string };

/** Les machines déclarées par le propriétaire, révoquées comprises : c'est son historique. */
export class ListWorkerKeysUseCase {
  constructor(private readonly repository: WorkerKeyRepository) {}

  async execute(query: ListWorkerKeysQuery): Promise<WorkerKeyView[]> {
    const keys = await this.repository.listOwnedBy(query.ownerId);
    return keys.map((key) => toWorkerKeyView(key.state()));
  }
}
