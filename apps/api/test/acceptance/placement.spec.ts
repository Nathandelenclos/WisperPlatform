import { describe, expect, it } from 'vitest';

import { TranscriptionNotFoundError } from '../../src/transcription/application/errors';
import { IllegalTranscriptionStateError } from '../../src/transcription/domain/errors';
import type { Claimant } from '../../src/transcription/application/ports/worker-identities';

import { OTHER_OWNER, OWNER, SERVICE_CLAIMANT, aPlatform } from './platform';

/** The claimant that a worker started by the owner presents to the queue. */
const OWNER_CLAIMANT: Claimant = { kind: 'owner', ownerId: OWNER };

describe('Scenario: choosing where the transcription is computed', () => {
  it('places the request on the service by default', async () => {
    const platform = aPlatform();
    const transcriptionId = await platform.upload();

    const view = await platform.getTranscription.execute({ transcriptionId, ownerId: OWNER });
    const [summary] = await platform.listTranscriptions.execute({ ownerId: OWNER });

    expect(view.placement).toBe('service');
    expect(summary.placement).toBe('service');
  });

  it('only offers a request placed on the owner\'s machine to that owner\'s machines', async () => {
    const platform = aPlatform();
    const transcriptionId = await platform.upload({ placement: 'owner' });

    // The service never sees it: it is not for the service, even when the service is idle.
    expect(
      await platform.claimNextTranscription.execute({
        claimant: SERVICE_CLAIMANT,
        workerId: 'service-worker',
        models: ['small'],
      }),
    ).toBeNull();
    // Nor does the machine of another owner.
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

  it('never offers a request placed on the service to an owner\'s machine', async () => {
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
      workerId: 'service-worker',
      models: ['small'],
    });

    expect(job?.transcriptionId).toBe(transcriptionId);
  });

  it('switches a pending request over to the service, which then claims it', async () => {
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
      workerId: 'service-worker',
      models: ['small'],
    });
    expect(job?.transcriptionId).toBe(transcriptionId);
  });

  it('does nothing when the requested placement is already the current one', async () => {
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

  it('refuses to switch a transcription that has already started', async () => {
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

  it('lets nobody else change the placement, nor discover it', async () => {
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

  it('refuses an unknown placement', async () => {
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

describe('Scenario: the owner\'s machine takes its owner\'s work', () => {
  it('claims nothing more once its key is revoked', async () => {
    const platform = aPlatform();
    await platform.upload({ placement: 'owner' });
    const { id, secret } = await platform.registerWorkerKey.execute({
      ownerId: OWNER,
      label: 'laptop',
    });

    // The worker presents its key, the platform derives the claimant from it, and it works.
    const claimant = await platform.workerIdentities.resolve(secret);
    expect(claimant).toEqual(OWNER_CLAIMANT);

    await platform.revokeWorkerKey.execute({ ownerId: OWNER, workerKeyId: id });

    // Key revoked: no claimant any more, so nothing left to claim — the 401 is issued by the
    // HTTP boundary, which no longer knows who is speaking.
    expect(await platform.workerIdentities.resolve(secret)).toBeNull();
  });
});
