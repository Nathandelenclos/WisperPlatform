import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { shouldParseJsonBody } from './auth/interface/json-body-policy';
import { ENV } from './shared/infrastructure/config/env';
import type { Env } from './shared/infrastructure/config/env';
import {
  CORRELATION_ID_HEADER,
  correlationStorage,
  resolveCorrelationId,
} from './shared/infrastructure/logging/correlation';

/** The API's JSON bodies carry metadata only — media go through multipart. */
const JSON_BODY_LIMIT = '1mb';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // No global parser: it is reinstalled just after, with an exception for the
    // authentication routes, which must receive the raw request.
    bodyParser: false,
  });

  app.useLogger(app.get(Logger));

  // First middleware of the chain: it opens the correlation context, so that every line
  // emitted during the request — access log as well as business log — carries the same
  // identifier. Registered here, therefore before anything Nest adds at initialization.
  app.use((request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const correlationId = resolveCorrelationId(request.headers[CORRELATION_ID_HEADER]);
    response.setHeader(CORRELATION_ID_HEADER, correlationId);
    correlationStorage.run(correlationId, next);
  });
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT, type: shouldParseJsonBody });
  app.setGlobalPrefix('api');

  const env = app.get<symbol, Env>(ENV);
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  app.enableShutdownHooks();

  await app.listen(env.PORT);
}

void bootstrap();
