import { UnauthorizedException, createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import type { Claimant } from '../../application/ports/worker-identities';

/** Requête enrichie par `WorkerTokenGuard`. Le champ n'est présent qu'après passage du guard. */
export type ClaimingRequest = { claimant?: Claimant };

/**
 * Expose à un controller le réclamant du worker qui appelle.
 * Échoue en 401 plutôt que de renvoyer `undefined` : sans `WorkerTokenGuard` en amont,
 * la route n'a aucune raison d'être servie.
 */
export const CurrentClaimant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Claimant => {
    const request = context.switchToHttp().getRequest<ClaimingRequest>();
    const claimant = request.claimant;
    if (claimant === undefined) {
      throw new UnauthorizedException('Jeton de worker requis');
    }
    return claimant;
  },
);
