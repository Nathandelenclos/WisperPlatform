import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { shouldParseJsonBody } from './auth/interface/json-body-policy';
import { ENV } from './shared/infrastructure/config/env';
import type { Env } from './shared/infrastructure/config/env';

/** Les corps JSON de l'API ne portent que des métadonnées ; les médias passent en multipart. */
const JSON_BODY_LIMIT = '1mb';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // Aucun analyseur global : il est réinstallé juste après, avec une exception pour
    // les routes d'authentification qui doivent recevoir la requête brute.
    bodyParser: false,
  });

  app.useLogger(app.get(Logger));
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT, type: shouldParseJsonBody });
  app.setGlobalPrefix('api');

  const env = app.get<symbol, Env>(ENV);
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  app.enableShutdownHooks();

  await app.listen(env.PORT);
}

void bootstrap();
