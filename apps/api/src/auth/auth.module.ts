import { Module } from '@nestjs/common';

import { ENV } from '../shared/infrastructure/config/env';
import type { Env } from '../shared/infrastructure/config/env';
import { DATABASE } from '../shared/infrastructure/persistence/database';
import type { Database } from '../shared/infrastructure/persistence/database';
import { SESSION_READER } from './application/ports/authentication';
import { AUTH_REQUEST_HANDLER } from './interface/auth-request-handler';
import { BetterAuthAuthentication } from './infrastructure/better-auth';
import { AuthController } from './interface/auth.controller';
import { SessionGuard } from './interface/session.guard';
import { SIGN_IN_OPTIONS, SignInOptionsController } from './interface/sign-in-options.controller';
import type { SignInOptions } from './interface/sign-in-options.controller';

/**
 * Composition root of authentication. A single instance of the identity provider serves both
 * ports — `SessionGuard` is exported for the contexts that protect their own routes.
 */
@Module({
  controllers: [AuthController, SignInOptionsController],
  providers: [
    {
      provide: BetterAuthAuthentication,
      useFactory: (database: Database, env: Env) =>
        new BetterAuthAuthentication({ database, env }),
      inject: [DATABASE, ENV],
    },
    { provide: SESSION_READER, useExisting: BetterAuthAuthentication },
    { provide: AUTH_REQUEST_HANDLER, useExisting: BetterAuthAuthentication },
    {
      // The configuration is read once, here, and the controller only knows the result: the
      // interface has no business knowing where an environment variable comes from.
      provide: SIGN_IN_OPTIONS,
      useFactory: (env: Env): SignInOptions => ({
        google: env.GOOGLE_CLIENT_ID !== undefined && env.GOOGLE_CLIENT_SECRET !== undefined,
      }),
      inject: [ENV],
    },
    SessionGuard,
  ],
  exports: [SESSION_READER, SessionGuard],
})
export class AuthModule {}
