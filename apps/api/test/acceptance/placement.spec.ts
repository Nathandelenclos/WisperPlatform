import { describe, expect, it } from 'vitest';

import { TranscriptionNotFoundError } from '../../src/transcription/application/errors';
import { IllegalTranscriptionStateError } from '../../src/transcription/domain/errors';
import type { Claimant } from '../../src/transcription/application/ports/worker-identities';

import { OTHER_OWNER, OWNER, SERVICE_CLAIMANT, aPlatform } from './platform';

/** Le réclamant qu'un worker lancé par le propriétaire présente à la file. */
const OWNER_CLAIMANT: Claimant = { kind: 'owner', ownerId: OWNER };

describe('Scénario : choisir où la transcription est calculée', () => {
  it('place la demande sur le service par défaut', async () => {
    const platform = aPlatform();
    const transcriptionId = await platform.upload();

    const view = await platform.getTranscription.execute({ transcriptionId, ownerId: OWNER });
    const [summary] = await platform.listTranscriptions.execute({ ownerId: OWNER });

    expect(view.placement).toBe('service');
    expect(summary.placement).toBe('service');
  });

  it('ne propose une demande placée sur la machine du propriétaire qu\'à ses machines', async () => {
    const platform = aPlatform();
    const transcriptionId = await platform.upload({ placement: 'owner' });

    // Le service, lui, ne la voit jamais : elle n'est pas pour lui, même s'il est libre.
    expect(
      await platform.claimNextTranscription.execute({
        claimant: SERVICE_CLAIMANT,
        workerId: 'worker-du-service',
        models: ['small'],
      }),
    ).toBeNull();
    // La machine d'un autre propriétaire non plus.
    expect(
      await platform.claimNextTranscription.execute({
        claimant: { kind: 'owner', ownerId: OTHER_OWNER },
        workerId: 'machine-de-bob',
        models: ['small'],
      }),
    ).toBeNull();

    const job = await platform.claimNextTranscription.execute({
      claimant: OWNER_CLAIMANT,
      workerId: 'machine-d-alice',
      models: ['small'],
    });

    expect(job?.transcriptionId).toBe(transcriptionId);
  });

  it('ne propose jamais une demande placée sur le service à la machine du propriétaire', async () => {
    const platform = aPlatform();
    const transcriptionId = await platform.upload({ placement: 'service' });

    expect(
      await platform.claimNextTranscription.execute({
        claimant: OWNER_CLAIMANT,
        workerId: 'machine-d-alice',
        models: ['small'],
      }),
    ).toBeNull();

    const job = await platform.claimNextTranscription.execute({
      claimant: SERVICE_CLAIMANT,
      workerId: 'worker-du-service',
      models: ['small'],
    });

    expect(job?.transcriptionId).toBe(transcriptionId);
  });

  it('bascule une demande en attente vers le service, qui la réclame alors', async () => {
    const platform = aPlatform();
    const transcriptionId = await platform.upload({ placement: 'owner' });
    platform.publisher.clear();

    const view = await platform.changePlacement.execute({
      transcriptionId,
      ownerId: OWNER,
      placement: 'service',
    });

    expect(view.placement).toBe('service');
    expect(platform.publisher.names()).toEqual(['transcription.placement-changed']);
    const job = await platform.claimNextTranscription.execute({
      claimant: SERVICE_CLAIMANT,
      workerId: 'worker-du-service',
      models: ['small'],
    });
    expect(job?.transcriptionId).toBe(transcriptionId);
  });

  it('ne fait rien quand le placement demandé est déjà le placement courant', async () => {
    const platform = aPlatform();
    const transcriptionId = await platform.upload({ placement: 'owner' });
    platform.publisher.clear();

    const view = await platform.changePlacement.execute({
      transcriptionId,
      ownerId: OWNER,
      placement: 'owner',
    });

    expect(view.placement).toBe('owner');
    expect(platform.publisher.names()).toEqual([]);
  });

  it('refuse de basculer une transcription déjà démarrée', async () => {
    const platform = aPlatform();
    const transcriptionId = await platform.upload({ placement: 'owner' });
    await platform.claimNextTranscription.execute({
      claimant: OWNER_CLAIMANT,
      workerId: 'machine-d-alice',
      models: ['small'],
    });

    await expect(
      platform.changePlacement.execute({
        transcriptionId,
        ownerId: OWNER,
        placement: 'service',
      }),
    ).rejects.toThrow(IllegalTranscriptionStateError);
    const view = await platform.getTranscription.execute({ transcriptionId, ownerId: OWNER });
    expect(view.placement).toBe('owner');
  });

  it('ne laisse personne d\'autre changer le placement, ni le découvrir', async () => {
    const platform = aPlatform();
    const transcriptionId = await platform.upload({ placement: 'owner' });

    await expect(
      platform.changePlacement.execute({
        transcriptionId,
        ownerId: OTHER_OWNER,
        placement: 'service',
      }),
    ).rejects.toThrow(TranscriptionNotFoundError);
  });

  it('refuse un placement inconnu', async () => {
    const platform = aPlatform();
    const transcriptionId = await platform.upload();

    await expect(
      platform.changePlacement.execute({
        transcriptionId,
        ownerId: OWNER,
        placement: 'ailleurs',
      }),
    ).rejects.toThrow(expect.objectContaining({ code: 'UNSUPPORTED_PLACEMENT' }));
  });
});

describe('Scénario : la machine du propriétaire prend le travail de son propriétaire', () => {
  it('ne réclame plus rien une fois sa clé révoquée', async () => {
    const platform = aPlatform();
    await platform.upload({ placement: 'owner' });
    const { id, secret } = await platform.registerWorkerKey.execute({
      ownerId: OWNER,
      label: 'portable',
    });

    // Le worker présente sa clé, la plateforme en déduit le réclamant, il travaille.
    const claimant = await platform.workerIdentities.resolve(secret);
    expect(claimant).toEqual(OWNER_CLAIMANT);

    await platform.revokeWorkerKey.execute({ ownerId: OWNER, workerKeyId: id });

    // Clé révoquée : plus de réclamant, donc plus rien à réclamer — le 401 est prononcé
    // par la frontière HTTP, qui ne sait plus qui parle.
    expect(await platform.workerIdentities.resolve(secret)).toBeNull();
  });
});
