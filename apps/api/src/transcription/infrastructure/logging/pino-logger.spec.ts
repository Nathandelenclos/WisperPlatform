import { describe, expect, it } from 'vitest';

import { correlationStorage } from '../../../shared/infrastructure/logging/correlation';

import { createPinoLogger } from './pino-logger';

function captureLines(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line: string) => lines.push(line) };
}

describe('PinoLogger', () => {
  it('ties every line to the request that caused it', () => {
    const sink = captureLines();
    const logger = createPinoLogger({ NODE_ENV: 'production' }, { write: sink.write });

    correlationStorage.run('req-42', () => {
      logger.warn('media access refused', { reason: 'stale-run' });
    });

    expect(JSON.parse(sink.lines[0])).toMatchObject({
      level: 'warn',
      msg: 'media access refused',
      reason: 'stale-run',
      correlationId: 'req-42',
    });
  });

  it('does not invent an identifier outside a request', () => {
    const sink = captureLines();
    const logger = createPinoLogger({ NODE_ENV: 'production' }, { write: sink.write });

    logger.info('stalled transcriptions swept', { requeued: 1 });

    expect(JSON.parse(sink.lines[0])).not.toHaveProperty('correlationId');
  });

  it('redacts personal data and secrets, at every depth', () => {
    const sink = captureLines();
    const logger = createPinoLogger({ NODE_ENV: 'production' }, { write: sink.write });

    logger.error('failure', {
      email: 'nathan@example.test',
      mediaToken: 'jeton-secret',
      originalName: 'réunion confidentielle.mov',
      nested: { password: 'motdepasse' },
    });

    const line = sink.lines[0];
    expect(line).not.toContain('nathan@example.test');
    expect(line).not.toContain('jeton-secret');
    expect(line).not.toContain('réunion confidentielle.mov');
    expect(line).not.toContain('motdepasse');
    expect(JSON.parse(line).email).toBe('[redacted]');
  });

  it('redacts a machine key secret, its fingerprint and its label', () => {
    const sink = captureLines();
    const logger = createPinoLogger({ NODE_ENV: 'production' }, { write: sink.write });

    logger.info('machine key declared', {
      secret: '256-bit-random',
      secretFingerprint: 'e'.repeat(64),
      label: 'Nathan laptop',
      workerKey: { secret: 'nested-random' },
    });

    const line = sink.lines[0];
    expect(line).not.toContain('256-bit-random');
    expect(line).not.toContain('e'.repeat(64));
    expect(line).not.toContain('Nathan laptop');
    expect(line).not.toContain('nested-random');
  });

  it('silences diagnostics in production and lets them through elsewhere', () => {
    const production = captureLines();
    createPinoLogger({ NODE_ENV: 'production' }, { write: production.write }).debug('diagnostic');
    const development = captureLines();
    createPinoLogger({ NODE_ENV: 'development' }, { write: development.write }).debug('diagnostic');

    expect(production.lines).toHaveLength(0);
    expect(development.lines).toHaveLength(1);
  });
});
