import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { WorkerKeyRepository } from '../../src/workers/application/ports/worker-key-repository';
import { WorkerKey, WorkerKeyLabel } from '../../src/workers/domain/worker-key';

import { CONTRACT_OWNER_A, CONTRACT_OWNER_B } from './transcription-repository.contract';

export type WorkerKeyRepositoryHarness = {
  repository: WorkerKeyRepository;
  cleanup: () => Promise<void>;
};

const CREATED_AT = new Date('2026-04-02T08:00:00.000Z');

function uuid(suffix: string): string {
  return `9d3f1a20-0000-4000-8000-${suffix.padStart(12, '0')}`;
}

function fingerprintOf(suffix: string): string {
  return suffix.repeat(64).slice(0, 64);
}

function aKey(p: {
  id: string;
  ownerId?: string;
  label?: string;
  createdAt?: Date;
}): WorkerKey {
  return WorkerKey.issue({
    id: p.id,
    ownerId: p.ownerId ?? CONTRACT_OWNER_A,
    label: WorkerKeyLabel.of(p.label ?? 'My laptop'),
    secretFingerprint: fingerprintOf(p.id.slice(-1)),
    createdAt: p.createdAt ?? CREATED_AT,
  });
}

/**
 * Contract suite of the machine key repository. Replayed identically on the in-memory double and
 * on the Postgres adapter: the lookup by fingerprint is an authentication path, it must not
 * behave differently depending on the technique underneath.
 */
export function describeWorkerKeyRepositoryContract(
  name: string,
  factory: () => Promise<WorkerKeyRepositoryHarness>,
): void {
  describe(name, () => {
    let harness: WorkerKeyRepositoryHarness;

    beforeEach(async () => {
      harness = await factory();
    });

    afterEach(async () => {
      await harness.cleanup();
    });

    it('reads back a whole key', async () => {
      const key = aKey({ id: uuid('1'), label: 'Living room desktop' });

      await harness.repository.save(key);

      expect((await harness.repository.findById(uuid('1')))?.state()).toEqual(key.state());
    });

    it('finds a key by its fingerprint, and nothing by an unknown fingerprint', async () => {
      await harness.repository.save(aKey({ id: uuid('2') }));

      const found = await harness.repository.findBySecretFingerprint(fingerprintOf('2'));

      expect(found?.id).toBe(uuid('2'));
      expect(await harness.repository.findBySecretFingerprint(fingerprintOf('f'))).toBeNull();
    });

    it('returns a revoked key from the lookup by fingerprint', async () => {
      // It is the domain that decides what a revocation prevents, not the query.
      const key = aKey({ id: uuid('3') });
      key.revoke(new Date('2026-04-03T08:00:00.000Z'));
      await harness.repository.save(key);

      const found = await harness.repository.findBySecretFingerprint(fingerprintOf('3'));

      expect(found).not.toBeNull();
      expect(found?.isActive).toBe(false);
    });

    it('replaces the previous state instead of stacking onto it', async () => {
      await harness.repository.save(aKey({ id: uuid('4') }));
      const key = await harness.repository.findById(uuid('4'));
      if (key === null) throw new Error('key not found');

      key.noteSeen(new Date('2026-04-02T09:00:00.000Z'));
      key.revoke(new Date('2026-04-02T10:00:00.000Z'));
      await harness.repository.save(key);

      const reloaded = await harness.repository.findById(uuid('4'));
      expect(reloaded?.state()).toEqual(key.state());
      expect(reloaded?.state().lastSeenAt).toEqual(new Date('2026-04-02T09:00:00.000Z'));
    });

    it('lists the keys of an owner, most recent first, revoked ones included', async () => {
      const revoked = aKey({
        id: uuid('5'),
        createdAt: new Date('2026-04-01T08:00:00.000Z'),
        label: 'older',
      });
      revoked.revoke(new Date('2026-04-02T08:00:00.000Z'));
      await harness.repository.save(revoked);
      await harness.repository.save(
        aKey({ id: uuid('6'), createdAt: new Date('2026-04-05T08:00:00.000Z'), label: 'newer' }),
      );
      await harness.repository.save(aKey({ id: uuid('7'), ownerId: CONTRACT_OWNER_B }));

      const keys = await harness.repository.listOwnedBy(CONTRACT_OWNER_A);

      expect(keys.map((key) => key.id)).toEqual([uuid('6'), uuid('5')]);
      expect(keys[1].isActive).toBe(false);
    });

    it('returns null for an unknown key and an empty list for an owner with no machine', async () => {
      expect(await harness.repository.findById(uuid('f'))).toBeNull();
      expect(await harness.repository.listOwnedBy(CONTRACT_OWNER_B)).toEqual([]);
    });
  });
}
