import { describe, expect, it } from 'vitest';

import { WorkerKeyNotFoundError } from '../../src/workers/application/errors';
import { InvalidWorkerKeyLabelError } from '../../src/workers/domain/errors';

import { NOW, OTHER_OWNER, OWNER, SERVICE_TOKEN, aPlatform } from './platform';

describe('Scénario : un utilisateur déclare sa machine', () => {
  it('rend le secret une seule fois, puis la liste ne le porte plus', async () => {
    const platform = aPlatform();

    const created = await platform.registerWorkerKey.execute({
      ownerId: OWNER,
      label: 'Mon portable',
    });

    expect(created.label).toBe('Mon portable');
    expect(created.createdAt).toEqual(NOW);
    expect(created.secret.length).toBeGreaterThan(0);

    const keys = await platform.listWorkerKeys.execute({ ownerId: OWNER });

    expect(keys).toEqual([
      { id: created.id, label: 'Mon portable', createdAt: NOW, lastSeenAt: null, revokedAt: null },
    ]);
    // Ni le secret ni son empreinte : la liste ne rend que ce qui identifie la machine.
    expect(JSON.stringify(keys)).not.toContain(created.secret);
  });

  it('donne un secret différent à chaque machine déclarée', async () => {
    const platform = aPlatform();

    const first = await platform.registerWorkerKey.execute({ ownerId: OWNER, label: 'portable' });
    const second = await platform.registerWorkerKey.execute({ ownerId: OWNER, label: 'tour' });

    expect(second.secret).not.toBe(first.secret);
    expect(second.id).not.toBe(first.id);
  });

  it('reconnaît la machine à son secret, et le secret partagé reste celui du service', async () => {
    const platform = aPlatform();
    const { secret } = await platform.registerWorkerKey.execute({
      ownerId: OWNER,
      label: 'portable',
    });

    expect(await platform.workerIdentities.resolve(secret)).toEqual({
      kind: 'owner',
      ownerId: OWNER,
    });
    expect(await platform.workerIdentities.resolve(SERVICE_TOKEN)).toEqual({ kind: 'service' });
    expect(await platform.workerIdentities.resolve('un-jeton-inventé')).toBeNull();
  });

  it('note le passage de la machine, mais pas à chaque battement de cœur', async () => {
    const platform = aPlatform();
    const { id, secret } = await platform.registerWorkerKey.execute({
      ownerId: OWNER,
      label: 'portable',
    });

    await platform.workerIdentities.resolve(secret);
    const seenOnce = (await platform.listWorkerKeys.execute({ ownerId: OWNER })).find(
      (key) => key.id === id,
    );
    expect(seenOnce?.lastSeenAt).toEqual(NOW);

    // Battement de cœur suivant, quelques secondes plus tard : rien n'est réécrit.
    platform.clock.advanceSeconds(5);
    await platform.workerIdentities.resolve(secret);
    expect(
      (await platform.listWorkerKeys.execute({ ownerId: OWNER })).find((key) => key.id === id)
        ?.lastSeenAt,
    ).toEqual(NOW);

    // Une minute passée, le passage est de nouveau noté.
    platform.clock.advanceSeconds(60);
    await platform.workerIdentities.resolve(secret);
    expect(
      (await platform.listWorkerKeys.execute({ ownerId: OWNER })).find((key) => key.id === id)
        ?.lastSeenAt,
    ).toEqual(new Date(NOW.getTime() + 65_000));
  });

  it('cesse de reconnaître une clé révoquée', async () => {
    const platform = aPlatform();
    const { id, secret } = await platform.registerWorkerKey.execute({
      ownerId: OWNER,
      label: 'portable volé',
    });

    await platform.revokeWorkerKey.execute({ ownerId: OWNER, workerKeyId: id });

    expect(await platform.workerIdentities.resolve(secret)).toBeNull();
    const keys = await platform.listWorkerKeys.execute({ ownerId: OWNER });
    expect(keys[0].revokedAt).toEqual(NOW);
  });

  it('accepte de révoquer deux fois la même clé sans rien changer', async () => {
    const platform = aPlatform();
    const { id } = await platform.registerWorkerKey.execute({ ownerId: OWNER, label: 'portable' });

    await platform.revokeWorkerKey.execute({ ownerId: OWNER, workerKeyId: id });
    platform.clock.advanceSeconds(3_600);
    await expect(
      platform.revokeWorkerKey.execute({ ownerId: OWNER, workerKeyId: id }),
    ).resolves.toBeUndefined();

    expect((await platform.listWorkerKeys.execute({ ownerId: OWNER }))[0].revokedAt).toEqual(NOW);
  });

  it('ne montre pas la clé d\'autrui et ne révèle pas son existence', async () => {
    const platform = aPlatform();
    const { id } = await platform.registerWorkerKey.execute({ ownerId: OWNER, label: 'portable' });

    expect(await platform.listWorkerKeys.execute({ ownerId: OTHER_OWNER })).toEqual([]);
    // Le même refus qu'une clé inexistante : rien ne distingue les deux.
    await expect(
      platform.revokeWorkerKey.execute({ ownerId: OTHER_OWNER, workerKeyId: id }),
    ).rejects.toThrow(WorkerKeyNotFoundError);
    await expect(
      platform.revokeWorkerKey.execute({ ownerId: OTHER_OWNER, workerKeyId: 'inconnue' }),
    ).rejects.toThrow(expect.objectContaining({ code: 'WORKER_KEY_NOT_FOUND' }));
  });

  it('refuse un libellé vide, trop long ou coupé en deux lignes', async () => {
    const platform = aPlatform();

    for (const label of ['', '   ', 'x'.repeat(61), 'mon\nportable']) {
      await expect(platform.registerWorkerKey.execute({ ownerId: OWNER, label })).rejects.toThrow(
        InvalidWorkerKeyLabelError,
      );
    }
    expect(await platform.listWorkerKeys.execute({ ownerId: OWNER })).toEqual([]);
  });
});
