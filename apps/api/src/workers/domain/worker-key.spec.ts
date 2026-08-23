import { describe, expect, it } from 'vitest';

import { InvalidWorkerKeyLabelError } from './errors';
import { WorkerKey, WorkerKeyLabel } from './worker-key';

const CREATED_AT = new Date('2026-05-01T09:00:00.000Z');
const FINGERPRINT = 'a'.repeat(64);

function aKey(): WorkerKey {
  return WorkerKey.issue({
    id: 'key-1',
    ownerId: 'alice',
    label: WorkerKeyLabel.of('Mon portable'),
    secretFingerprint: FINGERPRINT,
    createdAt: CREATED_AT,
  });
}

describe('WorkerKeyLabel', () => {
  it('accepte un libellé lisible et coupe les espaces qui l\'entourent', () => {
    expect(WorkerKeyLabel.of('  Mon portable  ').value).toBe('Mon portable');
  });

  it('refuse un libellé vide, trop long, multiligne ou porteur d\'un caractère de contrôle', () => {
    for (const label of ['', '   ', 'x'.repeat(61), 'mon\nportable', 'mon\u202Eportable']) {
      expect(() => WorkerKeyLabel.of(label)).toThrow(InvalidWorkerKeyLabelError);
    }
  });

  it('relit un libellé stocké sans le revalider', () => {
    // Une clé écrite sous une règle plus large doit rester révocable.
    expect(WorkerKeyLabel.restored('x'.repeat(200)).value).toHaveLength(200);
  });
});

describe('WorkerKey', () => {
  it('naît active, sans passage connu', () => {
    const key = aKey();

    expect(key.isActive).toBe(true);
    expect(key.lastSeen).toBeNull();
    expect(key.state()).toEqual({
      id: 'key-1',
      ownerId: 'alice',
      label: 'Mon portable',
      secretFingerprint: FINGERPRINT,
      createdAt: CREATED_AT,
      lastSeenAt: null,
      revokedAt: null,
    });
  });

  it('note le passage de la machine', () => {
    const key = aKey();
    const seenAt = new Date('2026-05-01T10:00:00.000Z');

    key.noteSeen(seenAt);

    expect(key.lastSeen).toEqual(seenAt);
    expect(key.isActive).toBe(true);
  });

  it('révoque une fois pour toutes : la seconde révocation ne déplace rien', () => {
    const key = aKey();
    const revokedAt = new Date('2026-05-02T09:00:00.000Z');

    key.revoke(revokedAt);
    key.revoke(new Date('2026-05-03T09:00:00.000Z'));

    expect(key.isActive).toBe(false);
    expect(key.state().revokedAt).toEqual(revokedAt);
  });

  it('ne laisse aucun appelant reculer une révocation par la Date qu\'il a passée', () => {
    const key = aKey();
    const revokedAt = new Date('2026-05-02T09:00:00.000Z');

    key.revoke(revokedAt);
    revokedAt.setFullYear(2030);

    expect(key.state().revokedAt).toEqual(new Date('2026-05-02T09:00:00.000Z'));
  });

  it('se relit à l\'identique depuis son état', () => {
    const key = aKey();
    key.noteSeen(new Date('2026-05-01T11:00:00.000Z'));
    key.revoke(new Date('2026-05-02T09:00:00.000Z'));

    expect(WorkerKey.restore(key.state()).state()).toEqual(key.state());
  });
});
