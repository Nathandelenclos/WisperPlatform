import { WorkerKey, WorkerKeyLabel } from '../../domain/worker-key';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { WorkerKeyRepository } from '../ports/worker-key-repository';
import type { WorkerKeySecrets } from '../ports/worker-key-secrets';
import { toWorkerKeyView, type RegisteredWorkerKeyView } from '../views';

export type RegisterWorkerKeyCommand = { ownerId: string; label: string };

/**
 * The user declares a machine. The secret returned here is the only one they will see: the
 * platform keeps nothing but its fingerprint, so it is unable to ever show it to them again.
 */
export class RegisterWorkerKeyUseCase {
  constructor(
    private readonly repository: WorkerKeyRepository,
    private readonly secrets: WorkerKeySecrets,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(command: RegisterWorkerKeyCommand): Promise<RegisteredWorkerKeyView> {
    // The label is validated before a secret is drawn: randomness is only produced for an
    // acceptable declaration.
    const label = WorkerKeyLabel.of(command.label);
    const secret = this.secrets.generate();

    const key = WorkerKey.issue({
      id: this.idGenerator.next(),
      ownerId: command.ownerId,
      label,
      secretFingerprint: this.secrets.fingerprint(secret),
      createdAt: this.clock.now(),
    });
    await this.repository.save(key);

    return { ...toWorkerKeyView(key.state()), secret };
  }
}
