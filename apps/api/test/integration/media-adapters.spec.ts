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

// Secret drawn on every run: a secret-shaped literal in the repository is exactly what the CI
// secret scan is built to find.
const TEST_SECRET = randomBytes(32).toString('hex');

// The two adapters that carry media access control replay their port's contract: this is what
// makes the acceptance scenarios, built on the doubles, transposable here.
describeMediaStorageContract('file system', async () => {
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

describe('FilesystemMediaStorage — trust boundary towards the disk', () => {
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

  it('refuses any key that could escape the store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wisper-store-'));
    const storage = new FilesystemMediaStorage(root);
    try {
      for (const key of hostileKeys) {
        await expect(storage.openRead(key)).rejects.toThrow(InvalidStorageKeyError);
        await expect(storage.remove(key)).rejects.toThrow(InvalidStorageKeyError);
        await expect(storage.adopt({ key, tempPath: join(root, 'whatever') })).rejects.toThrow(
          InvalidStorageKeyError,
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('HmacMediaAccessTokens — signature', () => {
  const issued = { transcriptionId: 'a-transcription', runId: 'a-run' };
  const expiresAt = new Date('2026-05-04T09:02:00.000Z');
  const now = new Date('2026-05-04T09:00:00.000Z');

  it('refuses an access token signed with another secret', () => {
    const token = new HmacMediaAccessTokens(randomBytes(32).toString('hex')).issue({
      ...issued,
      expiresAt,
    });

    expect(new HmacMediaAccessTokens(TEST_SECRET).verify({ token, now })).toBeNull();
  });

  it('refuses an access token whose target transcription was changed', () => {
    const tokens = new HmacMediaAccessTokens(TEST_SECRET);
    const parts = tokens.issue({ ...issued, expiresAt }).split('.');
    parts[0] = 'another-transcription';

    expect(tokens.verify({ token: parts.join('.'), now })).toBeNull();
  });

  it('never lets the secret leak into the token', () => {
    const token = new HmacMediaAccessTokens(TEST_SECRET).issue({ ...issued, expiresAt });

    expect(token).not.toContain(TEST_SECRET);
  });
});
