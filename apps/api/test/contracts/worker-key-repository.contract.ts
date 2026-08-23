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
    label: WorkerKeyLabel.of(p.label ?? 'Mon portable'),
    secretFingerprint: fingerprintOf(p.id.slice(-1)),
    createdAt: p.createdAt ?? CREATED_AT,
  });
}

/**
 * Suite de contrat du dépôt des clés de machine. Rejouée à l'identique sur le double en
 * mémoire et sur l'adaptateur Postgres : la recherche par empreinte est un chemin
 * d'authentification, elle ne doit pas se comporter différemment selon la technique en dessous.
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

    it('relit une clé entière', async () => {
      const key = aKey({ id: uuid('1'), label: 'Tour du salon' });

      await harness.repository.save(key);

      expect((await harness.repository.findById(uuid('1')))?.state()).toEqual(key.state());
    });

    it('retrouve une clé par son empreinte, et rien par une empreinte inconnue', async () => {
      await harness.repository.save(aKey({ id: uuid('2') }));

      const found = await harness.repository.findBySecretFingerprint(fingerprintOf('2'));

      expect(found?.id).toBe(uuid('2'));
      expect(await harness.repository.findBySecretFingerprint(fingerprintOf('f'))).toBeNull();
    });

    it('rend une clé révoquée à la recherche par empreinte', async () => {
      // C'est le domaine qui décide ce qu'une révocation empêche, pas la requête.
      const key = aKey({ id: uuid('3') });
      key.revoke(new Date('2026-04-03T08:00:00.000Z'));
      await harness.repository.save(key);

      const found = await harness.repository.findBySecretFingerprint(fingerprintOf('3'));

      expect(found).not.toBeNull();
      expect(found?.isActive).toBe(false);
    });

    it('remplace l\'état précédent au lieu de l\'empiler', async () => {
      await harness.repository.save(aKey({ id: uuid('4') }));
      const key = await harness.repository.findById(uuid('4'));
      if (key === null) throw new Error('clé introuvable');

      key.noteSeen(new Date('2026-04-02T09:00:00.000Z'));
      key.revoke(new Date('2026-04-02T10:00:00.000Z'));
      await harness.repository.save(key);

      const reloaded = await harness.repository.findById(uuid('4'));
      expect(reloaded?.state()).toEqual(key.state());
      expect(reloaded?.state().lastSeenAt).toEqual(new Date('2026-04-02T09:00:00.000Z'));
    });

    it('liste les clés d\'un propriétaire, la plus récente d\'abord, révoquées comprises', async () => {
      const revoked = aKey({
        id: uuid('5'),
        createdAt: new Date('2026-04-01T08:00:00.000Z'),
        label: 'ancienne',
      });
      revoked.revoke(new Date('2026-04-02T08:00:00.000Z'));
      await harness.repository.save(revoked);
      await harness.repository.save(
        aKey({ id: uuid('6'), createdAt: new Date('2026-04-05T08:00:00.000Z'), label: 'récente' }),
      );
      await harness.repository.save(aKey({ id: uuid('7'), ownerId: CONTRACT_OWNER_B }));

      const keys = await harness.repository.listOwnedBy(CONTRACT_OWNER_A);

      expect(keys.map((key) => key.id)).toEqual([uuid('6'), uuid('5')]);
      expect(keys[1].isActive).toBe(false);
    });

    it('rend null pour une clé inconnue et une liste vide pour un propriétaire sans machine', async () => {
      expect(await harness.repository.findById(uuid('f'))).toBeNull();
      expect(await harness.repository.listOwnedBy(CONTRACT_OWNER_B)).toEqual([]);
    });
  });
}
