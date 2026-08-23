import { UnauthorizedException, createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import type { AuthenticatedUser } from '../application/ports/authentication';

/** Request enriched by `SessionGuard`. The field is only present once the guard has run. */
export type AuthenticatedRequest = { authenticatedUser?: AuthenticatedUser };

/**
 * Exposes the user of the current session to a controller.
 * Fails with a 401 rather than returning `undefined`: without `SessionGuard` upstream,
 * there is no reason for the route to be served at all.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.authenticatedUser;
    if (user === undefined) {
      throw new UnauthorizedException('Session required');
    }
    return user;
  },
);
