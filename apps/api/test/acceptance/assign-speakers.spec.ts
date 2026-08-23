import { describe, expect, it } from 'vitest';

import { StaleRunError } from '../../src/transcription/domain/errors';

import {
  LEASE_SECONDS,
  NOW,
  OWNER,
  SERVICE_CLAIMANT,
  aClaimedTranscription,
  aPlatform,
  type TranscriptionPlatform,
} from './platform';

/**
 * Three transcribed segments, ready for a diarization pass. The run stays open: the worker
 * publishes the speaker turns before completing the transcription.
 */
async function aTranscribedTranscription(): Promise<{
  platform: TranscriptionPlatform;
  transcriptionId: string;
  runId: string;
}> {
  const platform = aPlatform();
  const { transcriptionId, runId } = await aClaimedTranscription(platform);
  await platform.appendTranscribedSegments.execute({
    transcriptionId,
    runId,
    batchSequence: 1,
    segments: [
      { startMs: 0, endMs: 1_000, text: 'hello everyone' },
      { startMs: 1_000, endMs: 2_000, text: 'thanks for having me' },
      { startMs: 5_000, endMs: 6_000, text: 'we will come back to it' },
    ],
  });
  platform.publisher.clear();
  return { platform, transcriptionId, runId };
}

describe('Scenario: the worker publishes the speaker turns', () => {
  it('assigns each segment the speaker that overlaps it most, and announces the speakers found', async () => {
    const { platform, transcriptionId, runId } = await aTranscribedTranscription();

    await platform.assignSpeakers.execute({
      transcriptionId,
      runId,
      turns: [
        { startMs: 0, endMs: 1_000, speaker: 0 },
        { startMs: 1_000, endMs: 2_000, speaker: 1 },
        { startMs: 4_800, endMs: 6_200, speaker: 1 },
      ],
    });

    const view = await platform.getTranscription.execute({ transcriptionId, ownerId: OWNER });
    expect(view.segments.map((segment) => segment.speakerIndex)).toEqual([0, 1, 1]);
    expect(view.speakers).toEqual([
      { index: 0, name: null },
      { index: 1, name: null },
    ]);
    expect(platform.publisher.published).toEqual([
      {
        name: 'transcription.speakers-assigned',
        transcriptionId,
        ownerId: OWNER,
        speakers: [
          { index: 0, name: null },
          { index: 1, name: null },
        ],
        segments: view.segments,
        occurredAt: NOW,
      },
    ]);
  });

  it('leaves a segment with no speaker when no turn overlaps it', async () => {
    const { platform, transcriptionId, runId } = await aTranscribedTranscription();

    await platform.assignSpeakers.execute({
      transcriptionId,
      runId,
      turns: [{ startMs: 0, endMs: 2_000, speaker: 0 }],
    });

    const view = await platform.getTranscription.execute({ transcriptionId, ownerId: OWNER });
    expect(view.segments.map((segment) => segment.speakerIndex)).toEqual([0, 0, null]);
    expect(view.speakers).toEqual([{ index: 0, name: null }]);
  });

  it('changes nothing when the worker replays the same publication', async () => {
    const { platform, transcriptionId, runId } = await aTranscribedTranscription();
    const turns = [
      { startMs: 0, endMs: 1_200, speaker: 1 },
      { startMs: 1_200, endMs: 6_000, speaker: 0 },
    ];

    await platform.assignSpeakers.execute({ transcriptionId, runId, turns });
    const first = await platform.getTranscription.execute({ transcriptionId, ownerId: OWNER });
    platform.publisher.clear();

    await platform.assignSpeakers.execute({ transcriptionId, runId, turns });

    const second = await platform.getTranscription.execute({ transcriptionId, ownerId: OWNER });
    expect(second).toEqual(first);
    // The replay does republish: what makes the operation safe is not silence, it is that the
    // event carries the complete state and not a delta. A subscriber that applies it twice
    // therefore gets the same view. That is the contract pinned here — an event that became
    // incremental would break the client on every new attempt by the worker.
    const republished = platform.publisher.published.filter(
      (event) => event.name === 'transcription.speakers-assigned',
    );
    expect(republished).toHaveLength(1);
    expect(republished[0]).toMatchObject({
      speakers: [
        { index: 0, name: null },
        { index: 1, name: null },
      ],
      segments: second.segments,
    });
  });

  it('refuses a publication that comes from a superseded attempt', async () => {
    const { platform, transcriptionId, runId } = await aTranscribedTranscription();
    // The first worker's lease expires and a second takes the transcription over: the initial
    // run is no longer allowed to write.
    platform.clock.advanceSeconds(LEASE_SECONDS + 1);
    await platform.requeueStalledTranscriptions.execute();
    const second = await platform.claimNextTranscription.execute({
      claimant: SERVICE_CLAIMANT,
      workerId: 'worker-2',
      models: ['small'],
    });
    if (second === null) throw new Error('the requeued transcription was not claimed');

    await expect(
      platform.assignSpeakers.execute({
        transcriptionId,
        runId,
        turns: [{ startMs: 0, endMs: 1_000, speaker: 0 }],
      }),
    ).rejects.toThrow(StaleRunError);
  });

  it('clears the assignment when diarization finds no turn at all', async () => {
    const { platform, transcriptionId, runId } = await aTranscribedTranscription();
    await platform.assignSpeakers.execute({
      transcriptionId,
      runId,
      turns: [{ startMs: 0, endMs: 6_000, speaker: 0 }],
    });

    await platform.assignSpeakers.execute({ transcriptionId, runId, turns: [] });

    const view = await platform.getTranscription.execute({ transcriptionId, ownerId: OWNER });
    expect(view.segments.map((segment) => segment.speakerIndex)).toEqual([null, null, null]);
    expect(view.speakers).toEqual([]);
  });
});
