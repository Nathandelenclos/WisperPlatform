import { WorkerKeyNotFoundError } from '../errors';
import type { Clock } from '../ports/clock';
import type { WorkerKeyRepository } from '../ports/worker-key-repository';

export type RevokeWorkerKeyCommand = { ownerId: string; workerKeyId: string };

/**
 * The owner withdraws trust from a machine. The key is not deleted: its trace stays visible in
 * their list, revoked — knowing that a key existed is part of what one wants to be able to read
 * after an incident.
 */
export class RevokeWorkerKeyUseCase {
  constructor(
    private readonly repository: WorkerKeyRepository,
    private readonly clock: Clock,
  ) {}

  async execute(command: RevokeWorkerKeyCommand): Promise<void> {
    const key = await this.repository.findById(command.workerKeyId);
    // A key that is not theirs does not, as far as they are concerned, exist.
    if (key === null || key.ownerId !== command.ownerId) {
      throw new WorkerKeyNotFoundError();
    }

    key.revoke(this.clock.now());
    await this.repository.save(key);
  }
}
