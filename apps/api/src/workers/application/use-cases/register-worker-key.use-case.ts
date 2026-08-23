import { WorkerKey, WorkerKeyLabel } from '../../domain/worker-key';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { WorkerKeyRepository } from '../ports/worker-key-repository';
import type { WorkerKeySecrets } from '../ports/worker-key-secrets';
import { toWorkerKeyView, type RegisteredWorkerKeyView } from '../views';

export type RegisterWorkerKeyCommand = { ownerId: string; label: string };

/**
 * L'utilisateur déclare une machine. Le secret rendu ici est le seul qu'il verra : la
 * plateforme n'en garde que l'empreinte, elle est donc incapable de le lui remontrer.
 */
export class RegisterWorkerKeyUseCase {
  constructor(
    private readonly repository: WorkerKeyRepository,
    private readonly secrets: WorkerKeySecrets,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(command: RegisterWorkerKeyCommand): Promise<RegisteredWorkerKeyView> {
    // On valide le libellé avant de tirer un secret : un aléa n'est produit que pour une
    // déclaration recevable.
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
