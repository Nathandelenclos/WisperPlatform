import { describe, expect, it } from 'vitest';

import { SpeakerNotFoundError } from '../../src/transcription/domain/errors';
import { TranscriptionNotFoundError } from '../../src/transcription/application/errors';

import {
  NOW,
  OTHER_OWNER,
  OWNER,
  aClaimedTranscription,
  aPlatform,
  type TranscriptionPlatform,
} from './platform';

/** A completed transcription whose diarization separated two voices. */
async function aDiarizedTranscription(): Promise<{
  platform: TranscriptionPlatform;
  transcriptionId: string;
}> {
  const platform = aPlatform();
  const { transcriptionId, runId } = await aClaimedTranscription(platform);
  await platform.appendTranscribedSegments.execute({
    transcriptionId,
    runId,
    batchSequence: 1,
    segments: [
      { startMs: 0, endMs: 1_000, text: 'bonjour à tous' },
      { startMs: 1_000, endMs: 2_000, text: 'merci de me recevoir' },
      { startMs: 2_000, endMs: 3_000, text: 'commençons' },
    ],
  });
  await platform.assignSpeakers.execute({
    transcriptionId,
    runId,
    turns: [
      { startMs: 0, endMs: 1_000, speaker: 0 },
      { startMs: 1_000, endMs: 2_000, speaker: 1 },
      { startMs: 2_000, endMs: 3_000, speaker: 0 },
    ],
  });
  await platform.completeTranscription.execute({ transcriptionId, runId });
  platform.publisher.clear();
  return { platform, transcriptionId };
}

describe('Scenario: the owner names a speaker', () => {
  it('renames the speaker across the whole transcription at once', async () => {
    const { platform, transcriptionId } = await aDiarizedTranscription();

    const view = await platform.renameSpeaker.execute({
      transcriptionId,
      ownerId: OWNER,
      index: 0,
      name: 'Marc',
    });

    expect(view.speakers).toEqual([
      { index: 0, name: 'Marc' },
      { index: 1, name: null },
    ]);
    // The gesture applies to the speaker, not to a segment: both of their segments follow.
    const exported = await platform.exportTranscription.execute({
      transcriptionId,
      ownerId: OWNER,
      format: 'txt',
    });
    expect(exported.body).toBe(
      'Marc : bonjour à tous\nSpeaker 2 : merci de me recevoir\nMarc : commençons\n',
    );
    expect(platform.publisher.published).toEqual([
      {
        name: 'transcription.speaker-renamed',
        transcriptionId,
        ownerId: OWNER,
        index: 0,
        speakerName: 'Marc',
        occurredAt: NOW,
      },
    ]);
  });

  it('refuses a speaker that diarization did not find', async () => {
    const { platform, transcriptionId } = await aDiarizedTranscription();

    await expect(
      platform.renameSpeaker.execute({
        transcriptionId,
        ownerId: OWNER,
        index: 7,
        name: 'Ghost',
      }),
    ).rejects.toThrow(SpeakerNotFoundError);
  });

  it('teaches nothing to anyone other than the owner', async () => {
    const { platform, transcriptionId } = await aDiarizedTranscription();

    await expect(
      platform.renameSpeaker.execute({
        transcriptionId,
        ownerId: OTHER_OWNER,
        index: 0,
        name: 'Marc',
      }),
    ).rejects.toThrow(TranscriptionNotFoundError);
  });

  it('refuses an empty name', async () => {
    const { platform, transcriptionId } = await aDiarizedTranscription();

    await expect(
      platform.renameSpeaker.execute({
        transcriptionId,
        ownerId: OWNER,
        index: 0,
        name: '   ',
      }),
    ).rejects.toThrow(expect.objectContaining({ code: 'INVALID_SPEAKER_NAME' }));
  });
});
