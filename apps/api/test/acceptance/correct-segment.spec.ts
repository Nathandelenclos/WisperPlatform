import { describe, expect, it } from 'vitest';

import {
  SegmentNotFoundError,
  TranscriptionNotCorrectableError,
} from '../../src/transcription/domain/errors';

import {
  NOW,
  OWNER,
  aClaimedTranscription,
  aPlatform,
  type TranscriptionPlatform,
} from './platform';

async function aCompletedTranscription(): Promise<{
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
      { startMs: 0, endMs: 1_000, text: 'bonjur' },
      { startMs: 1_000, endMs: 2_000, text: 'a tous' },
    ],
  });
  await platform.completeTranscription.execute({ transcriptionId, runId });
  platform.publisher.clear();
  return { platform, transcriptionId };
}

describe('Scénario : le propriétaire corrige un segment', () => {
  it('remplace le texte, marque le segment corrigé et l\'annonce', async () => {
    const { platform, transcriptionId } = await aCompletedTranscription();

    await platform.correctSegment.execute({
      transcriptionId,
      ownerId: OWNER,
      ordinal: 1,
      text: 'Bonjour',
    });

    const view = await platform.getTranscription.execute({ transcriptionId, ownerId: OWNER });
    expect(view.segments[0]).toEqual({
      ordinal: 1,
      startMs: 0,
      endMs: 1_000,
      text: 'Bonjour',
      corrected: true,
    });
    expect(view.segments[1].corrected).toBe(false);
    expect(platform.publisher.published).toEqual([
      {
        name: 'transcription.segment-corrected',
        transcriptionId,
        ownerId: OWNER,
        ordinal: 1,
        occurredAt: NOW,
      },
    ]);
  });

  it('refuse un ordinal qui n\'existe pas', async () => {
    const { platform, transcriptionId } = await aCompletedTranscription();

    await expect(
      platform.correctSegment.execute({
        transcriptionId,
        ownerId: OWNER,
        ordinal: 42,
        text: 'Bonjour',
      }),
    ).rejects.toThrow(SegmentNotFoundError);
  });

  it('refuse de corriger une transcription encore en cours', async () => {
    const platform = aPlatform();
    const { transcriptionId, runId } = await aClaimedTranscription(platform);
    await platform.appendTranscribedSegments.execute({
      transcriptionId,
      runId,
      batchSequence: 1,
      segments: [{ startMs: 0, endMs: 1_000, text: 'en cours' }],
    });

    await expect(
      platform.correctSegment.execute({
        transcriptionId,
        ownerId: OWNER,
        ordinal: 1,
        text: 'trop tôt',
      }),
    ).rejects.toThrow(TranscriptionNotCorrectableError);
  });
});
