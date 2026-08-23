import { createHash, timingSafeEqual } from 'node:crypto';

import type { AuthenticateWorkerKeyUseCase } from '../../../workers/application/use-cases/authenticate-worker-key.use-case';
import type { Claimant, WorkerIdentities } from '../../application/ports/worker-identities';

/**
 * Adaptateur du port `WorkerIdentities`. Deux populations de workers, un seul jeton porteur :
 *
 * 1. le secret partagé des workers de la plateforme, comparé en temps constant ;
 * 2. une clé de machine, résolue par le contexte `workers` qui en est l'autorité.
 *
 * La comparaison du secret partagé porte sur les empreintes SHA-256 des deux jetons : elles ont
 * toujours la même longueur, ce qui rend `timingSafeEqual` utilisable quelle que soit la valeur
 * présentée, et aucune fuite par la longueur n'est possible. Le jeton présenté n'est jamais
 * journalisé, et un jeton inconnu rend `null` sans dire pourquoi.
 */
export class WorkerKeyIdentities implements WorkerIdentities {
  private readonly expectedSharedToken: Buffer;

  constructor(
    sharedToken: string,
    private readonly workerKeys: AuthenticateWorkerKeyUseCase,
  ) {
    this.expectedSharedToken = createHash('sha256').update(sharedToken, 'utf8').digest();
  }

  async resolve(bearerToken: string): Promise<Claimant | null> {
    const presented = createHash('sha256').update(bearerToken, 'utf8').digest();
    if (timingSafeEqual(presented, this.expectedSharedToken)) {
      return { kind: 'service' };
    }

    const owner = await this.workerKeys.execute({ secret: bearerToken });
    return owner === null ? null : { kind: 'owner', ownerId: owner.ownerId };
  }
}
