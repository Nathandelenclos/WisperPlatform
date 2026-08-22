import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FilesystemMediaStorage,
  InvalidStorageKeyError,
} from '../../src/transcription/infrastructure/storage/filesystem-media-storage';
import { HmacMediaAccessTokens } from '../../src/transcription/infrastructure/security/hmac-media-access-tokens';
import { describeMediaAccessTokensContract } from '../contracts/media-access-tokens.contract';
import { describeMediaStorageContract } from '../contracts/media-storage.contract';

// Secret tiré à chaque exécution : un littéral en forme de secret dans le dépôt est ce
// que le scan de secrets de la CI est fait pour trouver.
const TEST_SECRET = randomBytes(32).toString('hex');

// Les deux adaptateurs porteurs du contrôle d'accès au média rejouent le contrat de leur port :
// c'est ce qui rend les scénarios d'acceptation, montés sur les doubles, transposables ici.
describeMediaStorageContract('système de fichiers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wisper-store-'));
  const incoming = await mkdtemp(join(tmpdir(), 'wisper-incoming-'));
  return {
    storage: new FilesystemMediaStorage(root),
    stage: async (tempPath, content) => writeFile(tempPath, content, 'utf8'),
    tempPath: (name) => join(incoming, name),
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
      await rm(incoming, { recursive: true, force: true });
    },
  };
});

describeMediaAccessTokensContract('HMAC-SHA256', () => new HmacMediaAccessTokens(TEST_SECRET));

describe('FilesystemMediaStorage — frontière de confiance vers le disque', () => {
  const hostileKeys = [
    '../escape',
    '..',
    '.',
    'a/b',
    '/etc/passwd',
    '',
    '.hidden',
    'a\0b',
    'x'.repeat(200),
  ];

  it('refuse toute clé qui pourrait sortir du magasin', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wisper-store-'));
    const storage = new FilesystemMediaStorage(root);
    try {
      for (const key of hostileKeys) {
        await expect(storage.openRead(key)).rejects.toThrow(InvalidStorageKeyError);
        await expect(storage.remove(key)).rejects.toThrow(InvalidStorageKeyError);
        await expect(storage.adopt({ key, tempPath: join(root, 'peu-importe') })).rejects.toThrow(
          InvalidStorageKeyError,
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('HmacMediaAccessTokens — signature', () => {
  const issued = { transcriptionId: 'a-transcription', runId: 'un-run' };
  const expiresAt = new Date('2026-05-04T09:02:00.000Z');
  const now = new Date('2026-05-04T09:00:00.000Z');

  it('refuse un laissez-passer signé avec un autre secret', () => {
    const token = new HmacMediaAccessTokens(randomBytes(32).toString('hex')).issue({
      ...issued,
      expiresAt,
    });

    expect(new HmacMediaAccessTokens(TEST_SECRET).verify({ token, now })).toBeNull();
  });

  it('refuse un laissez-passer dont on a changé la transcription visée', () => {
    const tokens = new HmacMediaAccessTokens(TEST_SECRET);
    const parts = tokens.issue({ ...issued, expiresAt }).split('.');
    parts[0] = 'une-autre-transcription';

    expect(tokens.verify({ token: parts.join('.'), now })).toBeNull();
  });

  it('ne laisse jamais fuir le secret dans le jeton', () => {
    const token = new HmacMediaAccessTokens(TEST_SECRET).issue({ ...issued, expiresAt });

    expect(token).not.toContain(TEST_SECRET);
  });
});
