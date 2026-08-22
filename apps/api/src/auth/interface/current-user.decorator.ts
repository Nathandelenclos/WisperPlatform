import { UnauthorizedException, createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import type { AuthenticatedUser } from '../application/ports/authentication';

/** Requête enrichie par `SessionGuard`. Le champ n'est présent qu'après passage du guard. */
export type AuthenticatedRequest = { authenticatedUser?: AuthenticatedUser };

/**
 * Expose l'utilisateur de la session courante à un controller.
 * Échoue en 401 plutôt que de renvoyer `undefined` : sans `SessionGuard` en amont,
 * la route n'a aucune raison d'être servie.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.authenticatedUser;
    if (user === undefined) {
      throw new UnauthorizedException('Session requise');
    }
    return user;
  },
);
