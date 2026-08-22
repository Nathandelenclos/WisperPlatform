import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';

import type { Env } from '../../shared/infrastructure/config/env';
import type { Database } from '../../shared/infrastructure/persistence/database';
import * as schema from '../../shared/infrastructure/persistence/schema';
import type {
  AuthRequestHandler,
  AuthenticatedUser,
  SessionReader,
} from '../application/ports/authentication';

/**
 * Fournisseur d'identité better-auth. Une seule instance, créée à la racine de composition,
 * qui sert les deux ports d'authentification (lecture de session et routes `/api/auth/*`).
 *
 * `basePath` reste celui de better-auth (`/api/auth`) : il coïncide exactement avec le préfixe
 * global `api` de l'application plus la route montée par le controller. `baseURL` n'est pas figé :
 * better-auth le déduit de la requête, ce qui évite une variable d'environnement de plus et
 * fonctionne derrière un proxy.
 */
export class BetterAuthAuthentication implements SessionReader, AuthRequestHandler {
  private readonly auth;
  private readonly nodeHandler;

  constructor(p: { database: Database; env: Pick<Env, 'BETTER_AUTH_SECRET' | 'WEB_ORIGIN'> }) {
    this.auth = betterAuth({
      database: drizzleAdapter(p.database, { provider: 'pg', schema }),
      emailAndPassword: { enabled: true },
      secret: p.env.BETTER_AUTH_SECRET,
      trustedOrigins: [p.env.WEB_ORIGIN],
    });
    this.nodeHandler = toNodeHandler(this.auth);
  }

  async readSession(headers: IncomingHttpHeaders): Promise<AuthenticatedUser | null> {
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(headers) });
    return session === null ? null : { id: session.user.id };
  }

  handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    return this.nodeHandler(request, response);
  }
}
