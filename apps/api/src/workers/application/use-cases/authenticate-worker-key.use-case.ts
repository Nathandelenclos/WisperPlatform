import type { Clock } from '../ports/clock';
import type { WorkerKeyRepository } from '../ports/worker-key-repository';
import type { WorkerKeySecrets } from '../ports/worker-key-secrets';

export type AuthenticateWorkerKeyCommand = { secret: string };

/**
 * Fenêtre en dessous de laquelle un nouveau passage n'est pas réécrit. Une machine réclame du
 * travail et bat du cœur en continu : noter chaque appel ferait une écriture par seconde et par
 * machine, pour une information qui se lit à la minute.
 */
const SEEN_REFRESH_SECONDS = 60;

/**
 * À qui appartient la machine qui présente ce secret ? Rend `null` pour un secret inconnu
 * comme pour une clé révoquée : l'appelant n'a pas à distinguer les deux, et rien ne doit
 * permettre de deviner qu'une clé a existé.
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
