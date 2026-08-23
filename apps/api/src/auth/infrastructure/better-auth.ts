import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Env } from '../../shared/infrastructure/config/env';
import type { Database } from '../../shared/infrastructure/persistence/database';
import * as schema from '../../shared/infrastructure/persistence/schema';
import type {
  AuthenticatedUser,
  RequestHeaders,
  SessionReader,
} from '../application/ports/authentication';
import type { AuthRequestHandler } from '../interface/auth-request-handler';

/**
 * better-auth identity provider. A single instance, created at the composition root, serving
 * both authentication ports (session reading and the `/api/auth/*` routes).
 *
 * `basePath` stays the better-auth one (`/api/auth`): it coincides exactly with the application's
 * global `api` prefix plus the route mounted by the controller. `baseURL` is not pinned:
 * better-auth derives it from the request, which spares one more environment variable and works
 * behind a proxy.
 */
export class BetterAuthAuthentication implements SessionReader, AuthRequestHandler {
  private readonly auth;
  private readonly nodeHandler;

  constructor(p: {
    database: Database;
    env: Pick<
      Env,
      'BETTER_AUTH_SECRET' | 'WEB_ORIGIN' | 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET'
    >;
  }) {
    this.auth = betterAuth({
      database: drizzleAdapter(p.database, { provider: 'pg', schema }),
      emailAndPassword: { enabled: true },
      // Google is only wired in when the operator has provided credentials: without them, the
      // platform self-hosts with no third-party account, which is the default mode. An empty
      // object here would make the click fail instead of hiding the button, hence its absence.
      socialProviders:
        p.env.GOOGLE_CLIENT_ID === undefined || p.env.GOOGLE_CLIENT_SECRET === undefined
          ? {}
          : {
              google: {
                clientId: p.env.GOOGLE_CLIENT_ID,
                clientSecret: p.env.GOOGLE_CLIENT_SECRET,
              },
            },
      secret: p.env.BETTER_AUTH_SECRET,
      trustedOrigins: [p.env.WEB_ORIGIN],
    });
    this.nodeHandler = toNodeHandler(this.auth);
  }

  async readSession(headers: RequestHeaders): Promise<AuthenticatedUser | null> {
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(headers) });
    return session === null ? null : { id: session.user.id };
  }

  handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    return this.nodeHandler(request, response);
  }
}
