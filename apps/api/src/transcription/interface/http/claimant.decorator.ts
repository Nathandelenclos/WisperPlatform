import { UnauthorizedException, createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import type { Claimant } from '../../application/ports/worker-identities';

/** Request enriched by `WorkerTokenGuard`. The field only exists once the guard has run. */
export type ClaimingRequest = { claimant?: Claimant };

/**
 * Exposes to a controller the claimant of the calling worker.
 * Fails with a 401 rather than returning `undefined`: without `WorkerTokenGuard` upstream,
 * the route has no reason to be served.
 */
export const CurrentClaimant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Claimant => {
    const request = context.switchToHttp().getRequest<ClaimingRequest>();
    const claimant = request.claimant;
    if (claimant === undefined) {
      throw new UnauthorizedException('Worker token required');
    }
    return claimant;
  },
);
