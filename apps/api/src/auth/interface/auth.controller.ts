import { All, Controller, Inject, Req, Res } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { AUTH_REQUEST_HANDLER } from '../application/ports/authentication';
import type { AuthRequestHandler } from '../application/ports/authentication';

/**
 * Monte l'intégralité des routes du fournisseur d'identité sous `/api/auth`.
 * La requête est passée brute (`@Req`/`@Res`) : le corps de ces routes n'est volontairement
 * pas analysé par l'application (voir la configuration du body parser dans `main.ts`).
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
