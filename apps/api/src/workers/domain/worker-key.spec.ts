import { describe, expect, it } from 'vitest';

import { InvalidWorkerKeyLabelError } from './errors';
import { WorkerKey, WorkerKeyLabel } from './worker-key';

const CREATED_AT = new Date('2026-05-01T09:00:00.000Z');
const FINGERPRINT = 'a'.repeat(64);

function aKey(): WorkerKey {
  return WorkerKey.issue({
    id: 'key-1',
    ownerId: 'alice',
    label: WorkerKeyLabel.of('My laptop'),
    secretFingerprint: FINGERPRINT,
    createdAt: CREATED_AT,
  });
}

describe('WorkerKeyLabel', () => {
  it('accepts a readable label and trims the whitespace around it', () => {
    expect(WorkerKeyLabel.of('  My laptop  ').value).toBe('My laptop');
  });

  it('refuses a label that is empty, too long, multiline or carrying a control character', () => {
    for (const label of ['', '   ', 'x'.repeat(61), 'my\nlaptop', 'my\u202Elaptop']) {
      expect(() => WorkerKeyLabel.of(label)).toThrow(InvalidWorkerKeyLabelError);
    }
  });

  it('reads a stored label back without revalidating it', () => {
    // A key written under a wider rule must stay revocable.
    expect(WorkerKeyLabel.restored('x'.repeat(200)).value).toHaveLength(200);
  });
});

describe('WorkerKey', () => {
  it('is born active, with no known sighting', () => {
    const key = aKey();

    expect(key.isActive).toBe(true);
    expect(key.lastSeen).toBeNull();
    expect(key.state()).toEqual({
      id: 'key-1',
      ownerId: 'alice',
      label: 'My laptop',
      secretFingerprint: FINGERPRINT,
      createdAt: CREATED_AT,
      lastSeenAt: null,
      revokedAt: null,
    });
  });

  it('records the sighting of the machine', () => {
    const key = aKey();
    const seenAt = new Date('2026-05-01T10:00:00.000Z');

    key.noteSeen(seenAt);

    expect(key.lastSeen).toEqual(seenAt);
    expect(key.isActive).toBe(true);
  });

  it('revokes once and for all: the second revocation moves nothing', () => {
    const key = aKey();
    const revokedAt = new Date('2026-05-02T09:00:00.000Z');

    key.revoke(revokedAt);
    key.revoke(new Date('2026-05-03T09:00:00.000Z'));

    expect(key.isActive).toBe(false);
    expect(key.state().revokedAt).toEqual(revokedAt);
  });

  it('lets no caller move a revocation back through the Date it passed in', () => {
    const key = aKey();
    const revokedAt = new Date('2026-05-02T09:00:00.000Z');

    key.revoke(revokedAt);
    revokedAt.setFullYear(2030);

    expect(key.state().revokedAt).toEqual(new Date('2026-05-02T09:00:00.000Z'));
  });

  it('reads back identically from its state', () => {
    const key = aKey();
    key.noteSeen(new Date('2026-05-01T11:00:00.000Z'));
    key.revoke(new Date('2026-05-02T09:00:00.000Z'));

    expect(WorkerKey.restore(key.state()).state()).toEqual(key.state());
  });
});
