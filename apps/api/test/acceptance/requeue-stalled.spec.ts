import { describe, expect, it } from 'vitest';

import {
  LEASE_SECONDS,
  MAX_ATTEMPTS,
  OWNER,
  SERVICE_CLAIMANT,
  aClaimedTranscription,
  aPlatform,
} from './platform';

describe('Scenario: a worker disappears and its lease expires', () => {
  it('requeues the request and announces it', async () => {
    const platform = aPlatform();
    const { transcriptionId } = await aClaimedTranscription(platform);

    platform.clock.advanceSeconds(LEASE_SECONDS + 1);
    const swept = await platform.requeueStalledTranscriptions.execute();

    expect(swept).toEqual({ requeued: 1 });
    const view = await platform.getTranscription.execute({ transcriptionId, ownerId: OWNER });
    expect(view.status).toBe('pending');
    expect(platform.publisher.names()).toEqual(['transcription.requeued']);
  });

  it('lets another worker take the work over from scratch', async () => {
    const platform = aPlatform();
    const { transcriptionId, runId } = await aClaimedTranscription(platform);
    await platform.appendTranscribedSegments.execute({
      transcriptionId,
      runId,
      batchSequence: 1,
      segments: [{ startMs: 0, endMs: 1_000, text: 'lost work' }],
    });
    platform.clock.advanceSeconds(LEASE_SECONDS + 1);
    await platform.requeueStalledTranscriptions.execute();
    platform.publisher.clear();

    const job = await platform.claimNextTranscription.execute({
      claimant: SERVICE_CLAIMANT,
      workerId: 'worker-2',
      models: ['small'],
    });

    expect(job?.transcriptionId).toBe(transcriptionId);
    expect(job?.runId).not.toBe(runId);
    const view = await platform.getTranscription.execute({ transcriptionId, ownerId: OWNER });
    expect(view.status).toBe('transcribing');
    expect(view.segments).toEqual([]);
  });

  it('does not touch a transcription whose lease is still running', async () => {
    const platform = aPlatform();
    const { transcriptionId } = await aClaimedTranscription(platform);

    platform.clock.advanceSeconds(LEASE_SECONDS - 1);
    const swept = await platform.requeueStalledTranscriptions.execute();

    expect(swept).toEqual({ requeued: 0 });
    const view = await platform.getTranscription.execute({ transcriptionId, ownerId: OWNER });
    expect(view.status).toBe('transcribing');
    expect(platform.publisher.published).toEqual([]);
  });

  it('does not touch a transcription whose lease was just renewed', async () => {
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

describe('Scenario: the attempts of a transcription are exhausted', () => {
  it('gives the request up after the last attempt', async () => {
    const platform = aPlatform();
    const { transcriptionId } = await aClaimedTranscription(platform);

    // Each cycle consumes one attempt: lease expired, requeue, fresh claim.
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
      platform.clock.advanceSeconds(LEASE_SECONDS + 1);
      expect(await platform.requeueStalledTranscriptions.execute()).toEqual({ requeued: 1 });
      const job = await platform.claimNextTranscription.execute({
        claimant: SERVICE_CLAIMANT,
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

  it('no longer offers an abandoned request to a worker', async () => {
    const platform = aPlatform();
    await aClaimedTranscription(platform);

    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
      platform.clock.advanceSeconds(LEASE_SECONDS + 1);
      await platform.requeueStalledTranscriptions.execute();
      await platform.claimNextTranscription.execute({
        claimant: SERVICE_CLAIMANT,
        workerId: `worker-${attempt + 1}`,
        models: ['small'],
      });
    }
    platform.clock.advanceSeconds(LEASE_SECONDS + 1);
    await platform.requeueStalledTranscriptions.execute();

    expect(
      await platform.claimNextTranscription.execute({ claimant: SERVICE_CLAIMANT, workerId: 'worker-9', models: ['small'] }),
    ).toBeNull();
  });
});
