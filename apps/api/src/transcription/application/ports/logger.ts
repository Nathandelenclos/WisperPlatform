/**
 * Structured log. The fields are technical data: never an email, never a token, never a
 * user file name.
 */
export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  debug(message: string, fields?: Record<string, unknown>): void;
}

export const LOGGER = Symbol('Logger');
