import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';

import { SESSION_READER } from '../application/ports/authentication';
import type { SessionReader } from '../application/ports/authentication';
import type { AuthenticatedRequest } from './current-user.decorator';

/** Requires a valid session and attaches the resolved identity to the request. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(SESSION_READER) private readonly sessions: SessionReader) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<IncomingMessage & AuthenticatedRequest>();
    const user = await this.sessions.readSession(request.headers);
    if (user === null) {
      throw new UnauthorizedException('Session missing or expired');
    }
    request.authenticatedUser = user;
    return true;
  }
}
