import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';

import { WORKER_IDENTITIES } from '../../application/ports/worker-identities';
import type { WorkerIdentities } from '../../application/ports/worker-identities';
import type { ClaimingRequest } from './claimant.decorator';

const BEARER_PREFIX = 'Bearer ';

/**
 * Protects the worker routes and attaches the resolved claimant to the request: the platform
 * worker and a user's machine come through the same door, and this is where we learn which
 * one is speaking.
 *
 * An unknown token — wrong shared secret, non-existent key or revoked key — yields the same
 * 401 with the same message: nothing lets the three be told apart. The presented token is
 * never logged.
 */
@Injectable()
export class WorkerTokenGuard implements CanActivate {
  constructor(@Inject(WORKER_IDENTITIES) private readonly identities: WorkerIdentities) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<IncomingMessage & ClaimingRequest>();
    const header = request.headers.authorization ?? '';
    const presented = header.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : '';

    const claimant = await this.identities.resolve(presented);
    if (claimant === null) {
      throw new UnauthorizedException('Invalid worker token');
    }
    request.claimant = claimant;
    return true;
  }
}
