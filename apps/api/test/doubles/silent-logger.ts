import type { Logger } from '../../src/transcription/application/ports/logger';

/** Journal muet : les tests d'acceptation parlent métier, pas journalisation. */
export class SilentLogger implements Logger {
  info(): void {}
  warn(): void {}
  error(): void {}
  debug(): void {}
}
