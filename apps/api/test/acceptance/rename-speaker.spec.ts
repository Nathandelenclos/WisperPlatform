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

/** Une transcription achevée dont la diarisation a séparé deux voix. */
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

describe('Scénario : le propriétaire nomme un locuteur', () => {
  it('renomme le locuteur pour toute la transcription d\'un coup', async () => {
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
    // Le geste porte sur le locuteur, pas sur un segment : les deux segments suivent.
    const exported = await platform.exportTranscription.execute({
      transcriptionId,
      ownerId: OWNER,
      format: 'txt',
    });
    expect(exported.body).toBe(
      'Marc : bonjour à tous\nLocuteur 2 : merci de me recevoir\nMarc : commençons\n',
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

  it('refuse un locuteur que la diarisation n\'a pas trouvé', async () => {
    const { platform, transcriptionId } = await aDiarizedTranscription();

    await expect(
      platform.renameSpeaker.execute({
        transcriptionId,
        ownerId: OWNER,
        index: 7,
        name: 'Fantôme',
      }),
    ).rejects.toThrow(SpeakerNotFoundError);
  });

  it('n\'apprend rien à quelqu\'un d\'autre que le propriétaire', async () => {
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

  it('refuse un nom vide', async () => {
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
