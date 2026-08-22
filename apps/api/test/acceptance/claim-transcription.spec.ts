import { describe, expect, it } from 'vitest';

import { MediaAccessDeniedError } from '../../src/transcription/application/errors';

import { LEASE_SECONDS, NOW, OWNER, aPlatform, readAll } from './platform';

describe('Scénario : un worker réclame du travail', () => {
  it('remet un seul travail, pose le bail et n\'apprend rien de l\'utilisateur', async () => {
    const platform = aPlatform();
    const transcriptionId = await platform.upload({ originalName: 'secret.mp3', model: 'turbo' });
    platform.publisher.clear();

    const job = await platform.claimNextTranscription.execute({
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

  it('ne donne pas deux fois le même travail à deux workers', async () => {
    const platform = aPlatform();
    await platform.upload();

    const first = await platform.claimNextTranscription.execute({
      workerId: 'worker-1',
      models: ['small'],
    });
    const second = await platform.claimNextTranscription.execute({
      workerId: 'worker-2',
      models: ['small'],
    });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('ne rend rien quand aucun travail n\'attend pour ses modèles', async () => {
    const platform = aPlatform();
    await platform.upload({ model: 'large' });

    expect(
      await platform.claimNextTranscription.execute({ workerId: 'worker-1', models: ['tiny'] }),
    ).toBeNull();
  });

  it('donne accès au média avec le laissez-passer du travail, sans nom de fichier', async () => {
    const platform = aPlatform();
    await platform.upload({ originalName: 'secret.mp3', content: 'octets audio' });
    const job = await platform.claimNextTranscription.execute({
      workerId: 'worker-1',
      models: ['small'],
    });

    const media = await platform.openMediaForRun.execute({ token: job?.mediaToken ?? '' });

    expect(await readAll(media.stream)).toBe('octets audio');
    expect(media.contentType).toBe('audio/mpeg');
    expect(media.byteSize).toBe('octets audio'.length);
    expect(Object.keys(media)).toEqual(['stream', 'contentType', 'byteSize']);
  });

  it('refuse le média à un laissez-passer inventé, expiré, ou d\'une tentative achevée', async () => {
    const platform = aPlatform();
    const transcriptionId = await platform.upload();
    const job = await platform.claimNextTranscription.execute({
      workerId: 'worker-1',
      models: ['small'],
    });
    const token = job?.mediaToken ?? '';

    await expect(platform.openMediaForRun.execute({ token: 'inventé' })).rejects.toThrow(
      MediaAccessDeniedError,
    );

    await platform.completeTranscription.execute({ transcriptionId, runId: job?.runId ?? '' });
    await expect(platform.openMediaForRun.execute({ token })).rejects.toThrow(
      MediaAccessDeniedError,
    );
  });

  it('refuse le média une fois le bail éteint', async () => {
    const platform = aPlatform();
    await platform.upload();
    const job = await platform.claimNextTranscription.execute({
      workerId: 'worker-1',
      models: ['small'],
    });

    platform.clock.advanceSeconds(LEASE_SECONDS + 1);

    await expect(
      platform.openMediaForRun.execute({ token: job?.mediaToken ?? '' }),
    ).rejects.toThrow(MediaAccessDeniedError);
  });
});
