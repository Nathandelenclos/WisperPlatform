import type { Logger } from '../../src/transcription/application/ports/logger';

/** Silent log: the acceptance tests speak business, not logging. */
export class SilentLogger implements Logger {
  info(): void {}
  warn(): void {}
  error(): void {}
  debug(): void {}
}
