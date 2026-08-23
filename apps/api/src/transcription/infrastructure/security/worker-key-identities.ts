import { createHash, timingSafeEqual } from 'node:crypto';

import type { AuthenticateWorkerKeyUseCase } from '../../../workers/application/use-cases/authenticate-worker-key.use-case';
import type { Claimant, WorkerIdentities } from '../../application/ports/worker-identities';

/**
 * Adapter for the `WorkerIdentities` port. Two populations of workers, one single bearer token:
 *
 * 1. the shared secret of the platform workers, compared in constant time;
 * 2. a machine key, resolved by the `workers` context, which is the authority on it.
 *
 * The shared-secret comparison is made on the SHA-256 fingerprints of both tokens: they always
 * have the same length, which makes `timingSafeEqual` usable whatever the value presented, and
 * no leak through length is possible. The presented token is never logged, and an unknown token
 * returns `null` without saying why.
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
