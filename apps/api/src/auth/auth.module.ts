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
 * Racine de composition de l'authentification. Une seule instance du fournisseur d'identité
 * sert les deux ports ; `SessionGuard` est exporté pour les contextes qui protègent leurs routes.
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
      // La configuration est lue une fois, ici, et le contrôleur ne connaît que le résultat :
      // l'interface n'a pas à savoir d'où vient une variable d'environnement.
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
