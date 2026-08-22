import pino from 'pino';

import type { Env } from '../../../shared/infrastructure/config/env';
import { correlationStorage } from '../../../shared/infrastructure/logging/correlation';
import type { Logger } from '../../application/ports/logger';

/**
 * Champs dont la valeur ne doit jamais atteindre un fichier de log, quelle que soit la
 * profondeur à laquelle ils apparaissent : secrets, jetons, et données personnelles
 * (l'email d'un utilisateur et le nom d'origine de son fichier en font partie).
 */
export const REDACTED_FIELDS: readonly string[] = [
  'password',
  'secret',
  'token',
  'mediaToken',
  'authorization',
  'cookie',
  'email',
  'originalName',
  'mediaName',
  'mediaOriginalName',
  'filename',
  'ipAddress',
];

const REDACTION_PATHS = REDACTED_FIELDS.flatMap((field) => [field, `*.${field}`]);

/**
 * Adaptateur du port `Logger` : une ligne JSON par message, niveaux respectés,
 * champs sensibles caviardés. Aucun `console.log` dans l'API.
 */
export class PinoLogger implements Logger {
  constructor(private readonly logger: pino.Logger) {}

  info(message: string, fields?: Record<string, unknown>): void {
    this.logger.info(fields ?? {}, message);
  }

  warn(message: string, fields?: Record<string, unknown>): void {
    this.logger.warn(fields ?? {}, message);
  }

  error(message: string, fields?: Record<string, unknown>): void {
    this.logger.error(fields ?? {}, message);
  }

  debug(message: string, fields?: Record<string, unknown>): void {
    this.logger.debug(fields ?? {}, message);
  }
}

/**
 * Instance pino de l'application : JSON sur stdout, caviardage actif.
 * `destination` n'existe que pour permettre à un test d'inspecter les lignes émises.
 */
export function createPinoLogger(
  env: Pick<Env, 'NODE_ENV'>,
  destination?: pino.DestinationStream,
): PinoLogger {
  const options: pino.LoggerOptions = {
    level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    redact: { paths: REDACTION_PATHS, censor: '[redacted]', remove: false },
    formatters: { level: (label) => ({ level: label }) },
    timestamp: pino.stdTimeFunctions.isoTime,
    // Chaque ligne applicative porte l'identifiant de la requête qui l'a provoquée, repris
    // du contexte asynchrone ouvert à l'entrée : le journal d'accès et le journal métier se
    // recoupent sans qu'aucun appelant n'ait à faire circuler l'identifiant.
    mixin: () => {
      const correlationId = correlationStorage.getStore();
      return correlationId === undefined ? {} : { correlationId };
    },
  };
  return new PinoLogger(destination ? pino(options, destination) : pino(options));
}
