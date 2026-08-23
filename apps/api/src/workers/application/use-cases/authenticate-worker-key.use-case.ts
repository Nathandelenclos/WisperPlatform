import type { Clock } from '../ports/clock';
import type { WorkerKeyRepository } from '../ports/worker-key-repository';
import type { WorkerKeySecrets } from '../ports/worker-key-secrets';

export type AuthenticateWorkerKeyCommand = { secret: string };

/**
 * Window below which a new sighting is not written again. A machine claims work and heartbeats
 * continuously: recording every call would mean one write per second and per machine, for a
 * piece of information that is read to the minute.
 */
const SEEN_REFRESH_SECONDS = 60;

/**
 * Who owns the machine presenting this secret? Returns `null` for an unknown secret as for a
 * revoked key: the caller has no business telling the two apart, and nothing must make it
 * possible to guess that a key ever existed.
 */
export class AuthenticateWorkerKeyUseCase {
  constructor(
    private readonly repository: WorkerKeyRepository,
    private readonly secrets: WorkerKeySecrets,
    private readonly clock: Clock,
  ) {}

  async execute(command: AuthenticateWorkerKeyCommand): Promise<{ ownerId: string } | null> {
    const key = await this.repository.findBySecretFingerprint(
      this.secrets.fingerprint(command.secret),
    );
    if (key === null || !key.isActive) {
      return null;
    }

    const now = this.clock.now();
    const lastSeen = key.lastSeen;
    if (lastSeen === null || now.getTime() - lastSeen.getTime() >= SEEN_REFRESH_SECONDS * 1_000) {
      key.noteSeen(now);
      await this.repository.save(key);
    }

    return { ownerId: key.ownerId };
  }
}
