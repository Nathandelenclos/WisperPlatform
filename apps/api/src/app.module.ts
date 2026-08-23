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

/** Configuration validated once only, when the root module is loaded. */
const env = loadEnv();

/** Shared connection: the database and its pool come from a single creation. */
const DATABASE_CONNECTION = Symbol('DatabaseConnection');

/** The media token travels in the path: it must never land in a log. */
const MEDIA_TOKEN_PATH = /^(\/api\/worker\/media\/)[^/]+/;

/**
 * Reduces a URL to what is useful for diagnosis: the query string is dropped and the media
 * token is masked. No user data survives.
 */
function safeRequestPath(url: string): string {
  return url.split('?', 1)[0].replace(MEDIA_TOKEN_PATH, '$1[redacted]');
}

/**
 * Configuration and persistence shared by every context. Global: the database connection is
 * unique for the process, and this is where the pool is closed again on shutdown.
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
          // A single source of identifier: the one already set in the async context by the
          // entry middleware, otherwise the received header, otherwise a new identifier.
          const id = resolveCorrelationId(
            request.headers[CORRELATION_ID_HEADER],
            correlationStorage.getStore(),
          );
          response.setHeader(CORRELATION_ID_HEADER, id);
          return id;
        },
        // The default serializers log headers and query string: we keep only the method, a
        // sanitized path and the status.
        serializers: {
          req: (request: { method?: string; url?: string }) => ({
            method: request.method,
            path: safeRequestPath(request.url ?? ''),
          }),
          res: (response: { statusCode?: number }) => ({
            statusCode: response.statusCode,
          }),
        },
        // Defense in depth: even if a sensitive field slips into an application log, it does
        // not come out of it in the clear.
        redact: {
          // A single list of sensitive fields for both logs: the one from the `Logger` port
          // adapter, plus the headers specific to the access log.
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
