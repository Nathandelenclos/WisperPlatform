import { describe, expect, it } from 'vitest';

import { MediaAccessDeniedError } from '../../src/transcription/application/errors';

import { LEASE_SECONDS, NOW, OWNER, SERVICE_CLAIMANT, aPlatform, readAll } from './platform';

describe('Scenario: a worker claims work', () => {
  it('hands out a single job, sets the lease and reveals nothing about the user', async () => {
    const platform = aPlatform();
    const transcriptionId = await platform.upload({ originalName: 'secret.mp3', model: 'turbo' });
    platform.publisher.clear();

    const job = await platform.claimNextTranscription.execute({
      claimant: SERVICE_CLAIMANT,
      workerId: 'worker-1',
      models: ['turbo', 'small'],
    });

    expect(job).not.toBeNull();
    expect(job?.transcriptionId).toBe(transcriptionId);
    expect(job?.model).toBe('turbo');
    expect(job?.language).toBe('fr');
    expect(job?.leaseExpiresAt).toEqual(new Date(NOW.getTime() + LEASE_SECONDS * 1_000));
    expect(JSON.stringify(job)).not.toContain('secret.mp3');
    expect(JSON.stringify(job)).not.toContain(OWNER);
    expect(platform.publisher.names()).toEqual(['transcription.started']);

    const view = await platform.getTranscription.execute({ transcriptionId, ownerId: OWNER });
    expect(view.status).toBe('transcribing');
  });

  it('never gives the same job to two workers', async () => {
    const platform = aPlatform();
    await platform.upload();

    const first = await platform.claimNextTranscription.execute({
      claimant: SERVICE_CLAIMANT,
      workerId: 'worker-1',
      models: ['small'],
    });
    const second = await platform.claimNextTranscription.execute({
      claimant: SERVICE_CLAIMANT,
      workerId: 'worker-2',
      models: ['small'],
    });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('returns nothing when no job is waiting for its models', async () => {
    const platform = aPlatform();
    await platform.upload({ model: 'large' });

    expect(
      await platform.claimNextTranscription.execute({ claimant: SERVICE_CLAIMANT, workerId: 'worker-1', models: ['tiny'] }),
    ).toBeNull();
  });

  it('grants access to the media with the job pass, and without the file name', async () => {
    const platform = aPlatform();
    await platform.upload({ originalName: 'secret.mp3', content: 'octets audio' });
    const job = await platform.claimNextTranscription.execute({
      claimant: SERVICE_CLAIMANT,
      workerId: 'worker-1',
      models: ['small'],
    });

    const media = await platform.openMediaForRun.execute({ token: job?.mediaToken ?? '' });

    expect(await readAll(media.stream)).toBe('octets audio');
    expect(media.contentType).toBe('audio/mpeg');
    expect(media.byteSize).toBe('octets audio'.length);
    // What the worker must not learn: the name of the uploaded file, and the owner.
    expect(JSON.stringify(media)).not.toContain('secret.mp3');
    expect(JSON.stringify(media)).not.toContain(OWNER);
  });

  it('refuses the media to a pass we did not issue', async () => {
    const platform = aPlatform();
    await platform.upload();
    const job = await platform.claimNextTranscription.execute({
      claimant: SERVICE_CLAIMANT,
      workerId: 'worker-1',
      models: ['small'],
    });
    // Same shape as a real pass, but with no signature: all an attacker can forge knowing
    // two identifiers.
    const forged = (job?.mediaToken ?? '').split('::').slice(0, 3).join('::');

    await expect(platform.openMediaForRun.execute({ token: forged })).rejects.toThrow(
      MediaAccessDeniedError,
    );
  });

  it('refuses the media to the pass of a completed attempt', async () => {
    const platform = aPlatform();
    const transcriptionId = await platform.upload();
    const job = await platform.claimNextTranscription.execute({
      claimant: SERVICE_CLAIMANT,
      workerId: 'worker-1',
      models: ['small'],
    });

    await platform.completeTranscription.execute({ transcriptionId, runId: job?.runId ?? '' });

    await expect(
      platform.openMediaForRun.execute({ token: job?.mediaToken ?? '' }),
    ).rejects.toThrow(MediaAccessDeniedError);
  });

  it('refuses the media once the lease has expired', async () => {
    const platform = aPlatform();
    await platform.upload();
    const job = await platform.claimNextTranscription.execute({
      claimant: SERVICE_CLAIMANT,
      workerId: 'worker-1',
      models: ['small'],
    });

    platform.clock.advanceSeconds(LEASE_SECONDS + 1);

    await expect(
      platform.openMediaForRun.execute({ token: job?.mediaToken ?? '' }),
    ).rejects.toThrow(MediaAccessDeniedError);
  });
});
