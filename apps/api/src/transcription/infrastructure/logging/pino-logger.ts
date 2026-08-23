import pino from 'pino';

import type { Env } from '../../../shared/infrastructure/config/env';
import { correlationStorage } from '../../../shared/infrastructure/logging/correlation';
import type { Logger } from '../../application/ports/logger';

/**
 * Fields whose value must never reach a log file: secrets, tokens, and personal data — a
 * user's email, the original name of their file, the name they gave a speaker and the one they
 * gave their machine are part of it.
 *
 * `secretFingerprint` is listed too: a fingerprint is not a secret, but it identifies the key
 * of a machine, and a log has no reason to carry it.
 */
export const REDACTED_FIELDS: readonly string[] = [
  'password',
  'secret',
  'token',
  'secretFingerprint',
  'mediaToken',
  'authorization',
  'cookie',
  'email',
  'originalName',
  'mediaName',
  'mediaOriginalName',
  'speakerName',
  'label',
  'filename',
  'ipAddress',
];

/**
 * Depths covered: the root, one level, two levels, and the elements of an array.
 * The previous comment promised "whatever the depth" — pino cannot do that, its paths are not
 * recursive. A scope stated exactly is worth more than a guarantee one wrongly relies on: the
 * domain structures fit into these four shapes, a sensitive field deeper down would NOT be
 * redacted.
 */
const REDACTION_PATHS = REDACTED_FIELDS.flatMap((field) => [
  field,
  `*.${field}`,
  `*.*.${field}`,
  `*[*].${field}`,
]);

/**
 * Adapter for the `Logger` port: one JSON line per message, levels honoured,
 * sensitive fields redacted. No `console.log` anywhere in the API.
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
 * The application's pino instance: JSON on stdout, redaction active.
 * `destination` exists only so that a test can inspect the emitted lines.
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
    // Every application line carries the identifier of the request that caused it, taken from
    // the asynchronous context opened on the way in: the access log and the business log line
    // up without any caller having to pass the identifier around.
    mixin: () => {
      const correlationId = correlationStorage.getStore();
      return correlationId === undefined ? {} : { correlationId };
    },
  };
  return new PinoLogger(destination ? pino(options, destination) : pino(options));
}
