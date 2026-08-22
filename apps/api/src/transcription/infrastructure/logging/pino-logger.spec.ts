import { describe, expect, it } from 'vitest';

import { correlationStorage } from '../../../shared/infrastructure/logging/correlation';

import { createPinoLogger } from './pino-logger';

function captureLines(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line: string) => lines.push(line) };
}

describe('PinoLogger', () => {
  it('rattache chaque ligne à la requête qui l\'a provoquée', () => {
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

  it('n\'invente pas d\'identifiant hors d\'une requête', () => {
    const sink = captureLines();
    const logger = createPinoLogger({ NODE_ENV: 'production' }, { write: sink.write });

    logger.info('stalled transcriptions swept', { requeued: 1 });

    expect(JSON.parse(sink.lines[0])).not.toHaveProperty('correlationId');
  });

  it('caviarde les données personnelles et les secrets, à toute profondeur', () => {
    const sink = captureLines();
    const logger = createPinoLogger({ NODE_ENV: 'production' }, { write: sink.write });

    logger.error('échec', {
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

  it('tait le diagnostic en production et le laisse passer ailleurs', () => {
    const production = captureLines();
    createPinoLogger({ NODE_ENV: 'production' }, { write: production.write }).debug('diagnostic');
    const development = captureLines();
    createPinoLogger({ NODE_ENV: 'development' }, { write: development.write }).debug('diagnostic');

    expect(production.lines).toHaveLength(0);
    expect(development.lines).toHaveLength(1);
  });
});
