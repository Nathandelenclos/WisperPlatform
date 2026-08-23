import { describe, expect, it } from 'vitest';

import { StaleRunError } from '../../src/transcription/domain/errors';

import { NOW, OWNER, aClaimedTranscription, aPlatform } from './platform';

describe('Scenario: the worker completes a transcription', () => {
  it('marks it completed, announces the end and makes it correctable', async () => {
    const platform = aPlatform();
    const { transcriptionId, runId } = await aClaimedTranscription(platform);
    await platform.appendTranscribedSegments.execute({
      transcriptionId,
      runId,
      batchSequence: 1,
      segments: [{ startMs: 0, endMs: 2_000, text: 'That is all.' }],
    });
    platform.publisher.clear();
    platform.clock.advanceSeconds(42);

    await platform.completeTranscription.execute({ transcriptionId, runId });

    const view = await platform.getTranscription.execute({ transcriptionId, ownerId: OWNER });
    expect(view.status).toBe('completed');
    expect(view.completedAt).toEqual(new Date(NOW.getTime() + 42_000));
    expect(view.failureReason).toBeNull();
    expect(platform.publisher.names()).toEqual(['transcription.completed']);
  });

  it('accepts a media file with no speech at all', async () => {
    const platform = aPlatform();
    const { transcriptionId, runId } = await aClaimedTranscription(platform);

    await platform.completeTranscription.execute({ transcriptionId, runId });

    const summaries = await platform.listTranscriptions.execute({ ownerId: OWNER });
    expect(summaries[0]).toMatchObject({ status: 'completed', segmentCount: 0, durationMs: 0 });
  });

  it('refuses a completion announced by an attempt that is no longer the current one', async () => {
    const platform = aPlatform();
    const { transcriptionId } = await aClaimedTranscription(platform);

    await expect(
      platform.completeTranscription.execute({ transcriptionId, runId: 'another-run' }),
    ).rejects.toThrow(StaleRunError);
  });
});

describe('Scenario: the worker reports a failure', () => {
  it('marks the failure, keeps the reason it was given and announces it', async () => {
    const platform = aPlatform();
    const { transcriptionId, runId } = await aClaimedTranscription(platform);

    await platform.failTranscription.execute({
      transcriptionId,
      runId,
      reason: 'whisper exited with code 137',
    });

    const view = await platform.getTranscription.execute({ transcriptionId, ownerId: OWNER });
    expect(view.status).toBe('failed');
    expect(view.failureReason).toBe('whisper exited with code 137');
    expect(platform.publisher.published).toEqual([
      {
        name: 'transcription.failed',
        transcriptionId,
        ownerId: OWNER,
        reason: 'whisper exited with code 137',
        occurredAt: NOW,
      },
    ]);
  });

  it('makes the failed transcription visible in the owner list', async () => {
    const platform = aPlatform();
    const { transcriptionId, runId } = await aClaimedTranscription(platform);

    await platform.failTranscription.execute({
      transcriptionId,
      runId,
      reason: 'unreadable media',
    });

    const summaries = await platform.listTranscriptions.execute({ ownerId: OWNER });
    expect(summaries[0]).toMatchObject({
      status: 'failed',
      failureReason: 'unreadable media',
      completedAt: null,
    });
  });

  it('does not accept a failure once the work is done', async () => {
    const platform = aPlatform();
    const { transcriptionId, runId } = await aClaimedTranscription(platform);
    await platform.completeTranscription.execute({ transcriptionId, runId });

    await expect(
      platform.failTranscription.execute({ transcriptionId, runId, reason: 'too late' }),
    ).rejects.toThrow(expect.objectContaining({ code: 'ILLEGAL_TRANSCRIPTION_STATE' }));
  });
});
