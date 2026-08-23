import { All, Controller, Inject, Req, Res } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { AUTH_REQUEST_HANDLER } from './auth-request-handler';
import type { AuthRequestHandler } from './auth-request-handler';

/**
 * Mounts every route of the identity provider under `/api/auth`.
 * The request is passed raw (`@Req`/`@Res`): the body of these routes is deliberately not
 * parsed by the application (see the body parser configuration in `main.ts`).
 */
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AUTH_REQUEST_HANDLER) private readonly authRequests: AuthRequestHandler,
  ) {}

  @All(['', '*path'])
  handle(
    @Req() request: IncomingMessage,
    @Res() response: ServerResponse,
  ): Promise<void> {
    return this.authRequests.handle(request, response);
  }
}
