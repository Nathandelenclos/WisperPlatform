import { describe, expect, it } from 'vitest';

import { WorkerKeyNotFoundError } from '../../src/workers/application/errors';
import { InvalidWorkerKeyLabelError } from '../../src/workers/domain/errors';

import { NOW, OTHER_OWNER, OWNER, SERVICE_TOKEN, aPlatform } from './platform';

describe('Scenario: a user declares their machine', () => {
  it('returns the secret exactly once, and the list never carries it again', async () => {
    const platform = aPlatform();

    const created = await platform.registerWorkerKey.execute({
      ownerId: OWNER,
      label: 'My laptop',
    });

    expect(created.label).toBe('My laptop');
    expect(created.createdAt).toEqual(NOW);
    expect(created.secret.length).toBeGreaterThan(0);

    const keys = await platform.listWorkerKeys.execute({ ownerId: OWNER });

    expect(keys).toEqual([
      { id: created.id, label: 'My laptop', createdAt: NOW, lastSeenAt: null, revokedAt: null },
    ]);
    // Neither the secret nor its fingerprint: the list returns only what identifies the machine.
    expect(JSON.stringify(keys)).not.toContain(created.secret);
  });

  it('gives a different secret to each declared machine', async () => {
    const platform = aPlatform();

    const first = await platform.registerWorkerKey.execute({ ownerId: OWNER, label: 'laptop' });
    const second = await platform.registerWorkerKey.execute({ ownerId: OWNER, label: 'desktop' });

    expect(second.secret).not.toBe(first.secret);
    expect(second.id).not.toBe(first.id);
  });

  it('recognizes the machine by its secret, and the shared secret stays the service one', async () => {
    const platform = aPlatform();
    const { secret } = await platform.registerWorkerKey.execute({
      ownerId: OWNER,
      label: 'laptop',
    });

    expect(await platform.workerIdentities.resolve(secret)).toEqual({
      kind: 'owner',
      ownerId: OWNER,
    });
    expect(await platform.workerIdentities.resolve(SERVICE_TOKEN)).toEqual({ kind: 'service' });
    expect(await platform.workerIdentities.resolve('a-made-up-token')).toBeNull();
  });

  it('records when the machine was last seen, but not on every heartbeat', async () => {
    const platform = aPlatform();
    const { id, secret } = await platform.registerWorkerKey.execute({
      ownerId: OWNER,
      label: 'laptop',
    });

    await platform.workerIdentities.resolve(secret);
    const seenOnce = (await platform.listWorkerKeys.execute({ ownerId: OWNER })).find(
      (key) => key.id === id,
    );
    expect(seenOnce?.lastSeenAt).toEqual(NOW);

    // Next heartbeat, a few seconds later: nothing is rewritten.
    platform.clock.advanceSeconds(5);
    await platform.workerIdentities.resolve(secret);
    expect(
      (await platform.listWorkerKeys.execute({ ownerId: OWNER })).find((key) => key.id === id)
        ?.lastSeenAt,
    ).toEqual(NOW);

    // Once a minute has passed, `lastSeenAt` moves again.
    platform.clock.advanceSeconds(60);
    await platform.workerIdentities.resolve(secret);
    expect(
      (await platform.listWorkerKeys.execute({ ownerId: OWNER })).find((key) => key.id === id)
        ?.lastSeenAt,
    ).toEqual(new Date(NOW.getTime() + 65_000));
  });

  it('stops recognizing a revoked key', async () => {
    const platform = aPlatform();
    const { id, secret } = await platform.registerWorkerKey.execute({
      ownerId: OWNER,
      label: 'stolen laptop',
    });

    await platform.revokeWorkerKey.execute({ ownerId: OWNER, workerKeyId: id });

    expect(await platform.workerIdentities.resolve(secret)).toBeNull();
    const keys = await platform.listWorkerKeys.execute({ ownerId: OWNER });
    expect(keys[0].revokedAt).toEqual(NOW);
  });

  it('accepts revoking the same key twice without changing anything', async () => {
    const platform = aPlatform();
    const { id } = await platform.registerWorkerKey.execute({ ownerId: OWNER, label: 'laptop' });

    await platform.revokeWorkerKey.execute({ ownerId: OWNER, workerKeyId: id });
    platform.clock.advanceSeconds(3_600);
    await expect(
      platform.revokeWorkerKey.execute({ ownerId: OWNER, workerKeyId: id }),
    ).resolves.toBeUndefined();

    expect((await platform.listWorkerKeys.execute({ ownerId: OWNER }))[0].revokedAt).toEqual(NOW);
  });

  it('never shows a key that belongs to someone else, nor reveals that it exists', async () => {
    const platform = aPlatform();
    const { id } = await platform.registerWorkerKey.execute({ ownerId: OWNER, label: 'laptop' });

    expect(await platform.listWorkerKeys.execute({ ownerId: OTHER_OWNER })).toEqual([]);
    // The same refusal as for a key that does not exist: nothing tells the two apart.
    await expect(
      platform.revokeWorkerKey.execute({ ownerId: OTHER_OWNER, workerKeyId: id }),
    ).rejects.toThrow(WorkerKeyNotFoundError);
    await expect(
      platform.revokeWorkerKey.execute({ ownerId: OTHER_OWNER, workerKeyId: 'inconnue' }),
    ).rejects.toThrow(expect.objectContaining({ code: 'WORKER_KEY_NOT_FOUND' }));
  });

  it('refuses a label that is empty, too long, or split over two lines', async () => {
    const platform = aPlatform();

    for (const label of ['', '   ', 'x'.repeat(61), 'my\nlaptop']) {
      await expect(platform.registerWorkerKey.execute({ ownerId: OWNER, label })).rejects.toThrow(
        InvalidWorkerKeyLabelError,
      );
    }
    expect(await platform.listWorkerKeys.execute({ ownerId: OWNER })).toEqual([]);
  });
});
