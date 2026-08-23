import { WorkerKeyNotFoundError } from '../errors';
import type { Clock } from '../ports/clock';
import type { WorkerKeyRepository } from '../ports/worker-key-repository';

export type RevokeWorkerKeyCommand = { ownerId: string; workerKeyId: string };

/**
 * Le propriétaire retire sa confiance à une machine. La clé n'est pas supprimée : sa trace
 * reste visible dans sa liste, révoquée — savoir qu'une clé a existé fait partie de ce qu'on
 * veut pouvoir lire après un incident.
 */
export class RevokeWorkerKeyUseCase {
  constructor(
    private readonly repository: WorkerKeyRepository,
    private readonly clock: Clock,
  ) {}

  async execute(command: RevokeWorkerKeyCommand): Promise<void> {
    const key = await this.repository.findById(command.workerKeyId);
    // Une clé qui n'est pas la sienne est, pour lui, inexistante.
    if (key === null || key.ownerId !== command.ownerId) {
      throw new WorkerKeyNotFoundError();
    }

    key.revoke(this.clock.now());
    await this.repository.save(key);
  }
}
