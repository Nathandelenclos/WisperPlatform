import { Global, Inject, Module } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';

import { AuthModule } from './auth/auth.module';
import { ENV, loadEnv } from './shared/infrastructure/config/env';
import {
  CORRELATION_ID_HEADER,
  correlationStorage,
  resolveCorrelationId,
} from './shared/infrastructure/logging/correlation';
import {
  DATABASE,
  DATABASE_POOL,
  createDatabaseConnection,
} from './shared/infrastructure/persistence/database';
import type { DatabaseConnection } from './shared/infrastructure/persistence/database';
import { REDACTED_FIELDS } from './transcription/infrastructure/logging/pino-logger';
import { TranscriptionModule } from './transcription/transcription.module';
import { WorkersModule } from './workers/workers.module';

/** Configuration validée une seule fois, au chargement du module racine. */
const env = loadEnv();

/** Connexion partagée : la base et son pool proviennent d'une création unique. */
const DATABASE_CONNECTION = Symbol('DatabaseConnection');

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
          // Une seule source d'identifiant : celui déjà posé dans le contexte asynchrone par
          // le middleware d'entrée, sinon l'en-tête reçu, sinon un nouvel identifiant.
          const id = resolveCorrelationId(
            request.headers[CORRELATION_ID_HEADER],
            correlationStorage.getStore(),
          );
          response.setHeader(CORRELATION_ID_HEADER, id);
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
          // Une seule liste de champs sensibles pour les deux journaux : celle de
          // l'adaptateur du port `Logger`, plus les en-têtes propres au journal d'accès.
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
            ...REDACTED_FIELDS,
            ...REDACTED_FIELDS.map((field) => `*.${field}`),
          ],
          censor: '[redacted]',
        },
      },
    }),
    AuthModule,
    TranscriptionModule,
    WorkersModule,
  ],
})
export class AppModule {}
