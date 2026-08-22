import { Global, Inject, Module } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';

import { AuthModule } from './auth/auth.module';
import { ENV, loadEnv } from './shared/infrastructure/config/env';
import {
  DATABASE,
  DATABASE_POOL,
  createDatabaseConnection,
} from './shared/infrastructure/persistence/database';
import type { DatabaseConnection } from './shared/infrastructure/persistence/database';
import { TranscriptionModule } from './transcription/transcription.module';

/** Configuration validée une seule fois, au chargement du module racine. */
const env = loadEnv();

/** Connexion partagée : la base et son pool proviennent d'une création unique. */
const DATABASE_CONNECTION = Symbol('DatabaseConnection');

/** En-tête de corrélation accepté en entrée et renvoyé sur chaque réponse. */
const CORRELATION_HEADER = 'x-request-id';

/**
 * Un identifiant de corrélation fourni par un client est repris tel quel, mais seulement s'il
 * est inoffensif : sans cette contrainte, un appelant pourrait injecter des sauts de ligne
 * dans les journaux et y forger des entrées.
 */
const CORRELATION_ID_PATTERN = /^[\w.:-]{1,128}$/;

/** Le jeton média voyage dans le chemin : il ne doit jamais atterrir dans un journal. */
const MEDIA_TOKEN_PATH = /^(\/api\/worker\/media\/)[^/]+/;

/**
 * Réduit une URL à ce qui est utile au diagnostic : la chaîne de requête est jetée et le
 * jeton média est masqué. Aucune donnée d'utilisateur ne subsiste.
 */
function safeRequestPath(url: string): string {
  return url.split('?', 1)[0].replace(MEDIA_TOKEN_PATH, '$1[redacted]');
}

/**
 * Configuration et persistance partagées par tous les contextes. Global : la connexion à la
 * base est unique pour le processus, et c'est ici que le pool est refermé à l'arrêt.
 */
@Global()
@Module({
  providers: [
    { provide: ENV, useValue: env },
    { provide: DATABASE_CONNECTION, useFactory: createDatabaseConnection, inject: [ENV] },
    {
      provide: DATABASE,
      useFactory: (connection: DatabaseConnection) => connection.db,
      inject: [DATABASE_CONNECTION],
    },
    {
      provide: DATABASE_POOL,
      useFactory: (connection: DatabaseConnection) => connection.pool,
      inject: [DATABASE_CONNECTION],
    },
  ],
  exports: [ENV, DATABASE, DATABASE_POOL],
})
class PlatformModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Module({
  imports: [
    PlatformModule,
    LoggerModule.forRoot({
      pinoHttp: {
        level: env.NODE_ENV === 'production' ? 'info' : 'debug',
        genReqId: (request: IncomingMessage, response: ServerResponse) => {
          const inbound = request.headers[CORRELATION_HEADER];
          const candidate = Array.isArray(inbound) ? inbound[0] : inbound;
          const id =
            candidate !== undefined && CORRELATION_ID_PATTERN.test(candidate)
              ? candidate
              : randomUUID();
          response.setHeader(CORRELATION_HEADER, id);
          return id;
        },
        // Les sérialiseurs par défaut journalisent en-têtes et chaîne de requête : on ne garde
        // que la méthode, un chemin assaini et le statut.
        serializers: {
          req: (request: { method?: string; url?: string }) => ({
            method: request.method,
            path: safeRequestPath(request.url ?? ''),
          }),
          res: (response: { statusCode?: number }) => ({
            statusCode: response.statusCode,
          }),
        },
        // Défense en profondeur : même si un champ sensible se glisse dans un journal
        // applicatif, il n'en sort pas en clair.
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
            'token',
            'mediaToken',
            'password',
            'secret',
            'email',
            '*.token',
            '*.mediaToken',
            '*.password',
            '*.secret',
            '*.email',
          ],
          censor: '[redacted]',
        },
      },
    }),
    AuthModule,
    TranscriptionModule,
  ],
})
export class AppModule {}
