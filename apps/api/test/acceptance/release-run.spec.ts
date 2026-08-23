import { describe, expect, it } from 'vitest';

import { StaleRunError } from '../../src/transcription/domain/errors';

import { NOW, OWNER, SERVICE_CLAIMANT, aClaimedTranscription, aPlatform } from './platform';

describe('Scenario: a worker releases its attempt as it shuts down', () => {
  it('requeues the request right away, without waiting for the lease to expire', async () => {
    const platform = aPlatform();
    const { transcriptionId, runId } = await aClaimedTranscription(platform);
    await platform.appendTranscribedSegments.execute({
      transcriptionId,
      runId,
      batchSequence: 1,
      segments: [{ startMs: 0, endMs: 1_000, text: 'à moitié dit' }],
    });
    platform.publisher.clear();

    await platform.releaseTranscriptionRun.execute({ transcriptionId, runId });

    const view = await platform.getTranscription.execute({ transcriptionId, ownerId: OWNER });
    expect(view.status).toBe('pending');
    expect(platform.publisher.names()).toEqual(['transcription.requeued']);
  });

  it('makes the request claimable immediately by another worker', async () => {
    const platform = aPlatform();
    const { transcriptionId, runId } = await aClaimedTranscription(platform);

    await platform.releaseTranscriptionRun.execute({ transcriptionId, runId });
    const job = await platform.claimNextTranscription.execute({
      claimant: SERVICE_CLAIMANT,
      workerId: 'worker-2',
      models: ['small'],
    });

    expect(job?.transcriptionId).toBe(transcriptionId);
    // The released attempt still counts: a machine that restarts in a loop ends up exhausting
    // its attempts instead of spinning forever on the same request.
    expect(job?.runId).not.toBe(runId);
  });

  it('refuses to release an attempt that is no longer the current one', async () => {
    const platform = aPlatform();
    const { transcriptionId, runId } = await aClaimedTranscription(platform);
    await platform.releaseTranscriptionRun.execute({ transcriptionId, runId });
    await platform.claimNextTranscription.execute({ claimant: SERVICE_CLAIMANT, workerId: 'worker-2', models: ['small'] });

    await expect(
      platform.releaseTranscriptionRun.execute({ transcriptionId, runId }),
    ).rejects.toThrow(StaleRunError);
    expect(NOW).toBeInstanceOf(Date);
  });
});
