import { describe, expect, it } from 'vitest';

import { LEASE_SECONDS, MAX_ATTEMPTS, OWNER, aClaimedTranscription, aPlatform } from './platform';

describe('Scénario : un worker disparaît et son bail s\'éteint', () => {
  it('remet la demande en file et l\'annonce', async () => {
    const platform = aPlatform();
    const { transcriptionId } = await aClaimedTranscription(platform);

    platform.clock.advanceSeconds(LEASE_SECONDS + 1);
    const swept = await platform.requeueStalledTranscriptions.execute();

    expect(swept).toEqual({ requeued: 1 });
    const view = await platform.getTranscription.execute({ transcriptionId, ownerId: OWNER });
    expect(view.status).toBe('pending');
    expect(platform.publisher.names()).toEqual(['transcription.requeued']);
  });

  it('laisse un autre worker reprendre le travail depuis zéro', async () => {
    const platform = aPlatform();
    const { transcriptionId, runId } = await aClaimedTranscription(platform);
    await platform.appendTranscribedSegments.execute({
      transcriptionId,
      runId,
      batchSequence: 1,
      segments: [{ startMs: 0, endMs: 1_000, text: 'travail perdu' }],
    });
    platform.clock.advanceSeconds(LEASE_SECONDS + 1);
    await platform.requeueStalledTranscriptions.execute();
    platform.publisher.clear();

    const job = await platform.claimNextTranscription.execute({
      workerId: 'worker-2',
      models: ['small'],
    });

    expect(job?.transcriptionId).toBe(transcriptionId);
    expect(job?.runId).not.toBe(runId);
    const view = await platform.getTranscription.execute({ transcriptionId, ownerId: OWNER });
    expect(view.status).toBe('transcribing');
    expect(view.segments).toEqual([]);
  });

  it('ne touche pas à une transcription dont le bail court encore', async () => {
    const platform = aPlatform();
    const { transcriptionId } = await aClaimedTranscription(platform);

    platform.clock.advanceSeconds(LEASE_SECONDS - 1);
    const swept = await platform.requeueStalledTranscriptions.execute();

    expect(swept).toEqual({ requeued: 0 });
    const view = await platform.getTranscription.execute({ transcriptionId, ownerId: OWNER });
    expect(view.status).toBe('transcribing');
    expect(platform.publisher.published).toEqual([]);
  });

  it('ne touche pas à une transcription dont le bail vient d\'être renouvelé', async () => {
    const platform = aPlatform();
    const { transcriptionId, runId } = await aClaimedTranscription(platform);

    platform.clock.advanceSeconds(LEASE_SECONDS - 5);
    await platform.renewTranscriptionLease.execute({ transcriptionId, runId });
    platform.clock.advanceSeconds(10);
    const swept = await platform.requeueStalledTranscriptions.execute();

    expect(swept).toEqual({ requeued: 0 });
    expect(
      (await platform.getTranscription.execute({ transcriptionId, ownerId: OWNER })).status,
    ).toBe('transcribing');
  });
});

describe('Scénario : les tentatives d\'une transcription sont épuisées', () => {
  it('abandonne la demande après la dernière tentative', async () => {
    const platform = aPlatform();
    const { transcriptionId } = await aClaimedTranscription(platform);

    // Chaque cycle consomme une tentative : bail éteint, remise en file, nouvelle réclamation.
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
      platform.clock.advanceSeconds(LEASE_SECONDS + 1);
      expect(await platform.requeueStalledTranscriptions.execute()).toEqual({ requeued: 1 });
      const job = await platform.claimNextTranscription.execute({
        workerId: `worker-${attempt + 1}`,
        models: ['small'],
      });
      expect(job).not.toBeNull();
    }
    platform.publisher.clear();

    platform.clock.advanceSeconds(LEASE_SECONDS + 1);
    const swept = await platform.requeueStalledTranscriptions.execute();

    expect(swept).toEqual({ requeued: 0 });
    const view = await platform.getTranscription.execute({ transcriptionId, ownerId: OWNER });
    expect(view.status).toBe('failed');
    expect(view.failureReason).toBe('lease expired');
    expect(platform.publisher.names()).toEqual(['transcription.failed']);
  });

  it('ne propose plus une demande abandonnée à un worker', async () => {
    const platform = aPlatform();
    await aClaimedTranscription(platform);

    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
      platform.clock.advanceSeconds(LEASE_SECONDS + 1);
      await platform.requeueStalledTranscriptions.execute();
      await platform.claimNextTranscription.execute({
        workerId: `worker-${attempt + 1}`,
        models: ['small'],
      });
    }
    platform.clock.advanceSeconds(LEASE_SECONDS + 1);
    await platform.requeueStalledTranscriptions.execute();

    expect(
      await platform.claimNextTranscription.execute({ workerId: 'worker-9', models: ['small'] }),
    ).toBeNull();
  });
});
