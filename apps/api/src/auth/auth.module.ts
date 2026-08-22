import { Module } from '@nestjs/common';

import { ENV } from '../shared/infrastructure/config/env';
import type { Env } from '../shared/infrastructure/config/env';
import { DATABASE } from '../shared/infrastructure/persistence/database';
import type { Database } from '../shared/infrastructure/persistence/database';
import { AUTH_REQUEST_HANDLER, SESSION_READER } from './application/ports/authentication';
import { BetterAuthAuthentication } from './infrastructure/better-auth';
import { AuthController } from './interface/auth.controller';
import { SessionGuard } from './interface/session.guard';

/**
 * Racine de composition de l'authentification. Une seule instance du fournisseur d'identité
 * sert les deux ports ; `SessionGuard` est exporté pour les contextes qui protègent leurs routes.
 */
@Module({
  controllers: [AuthController],
  providers: [
    {
      provide: BetterAuthAuthentication,
      useFactory: (database: Database, env: Env) =>
        new BetterAuthAuthentication({ database, env }),
      inject: [DATABASE, ENV],
    },
    { provide: SESSION_READER, useExisting: BetterAuthAuthentication },
    { provide: AUTH_REQUEST_HANDLER, useExisting: BetterAuthAuthentication },
    SessionGuard,
  ],
  exports: [SESSION_READER, SessionGuard],
})
export class AuthModule {}
