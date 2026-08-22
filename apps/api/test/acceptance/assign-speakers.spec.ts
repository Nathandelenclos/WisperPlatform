import { describe, expect, it } from 'vitest';

import { StaleRunError } from '../../src/transcription/domain/errors';

import {
  LEASE_SECONDS,
  NOW,
  OWNER,
  aClaimedTranscription,
  aPlatform,
  type TranscriptionPlatform,
} from './platform';

/**
 * Trois segments transcrits, prêts à recevoir une passe de diarisation. Le run reste ouvert :
 * le worker publie les tours de parole avant d'achever la transcription.
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
      { startMs: 0, endMs: 1_000, text: 'bonjour à tous' },
      { startMs: 1_000, endMs: 2_000, text: 'merci de me recevoir' },
      { startMs: 5_000, endMs: 6_000, text: 'nous y reviendrons' },
    ],
  });
  platform.publisher.clear();
  return { platform, transcriptionId, runId };
}

describe('Scénario : le worker publie les tours de parole', () => {
  it('attribue à chaque segment le locuteur qui le recouvre le plus, et annonce les locuteurs découverts', async () => {
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

  it('laisse sans locuteur un segment qu\'aucun tour ne recouvre', async () => {
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

  it('ne change rien quand le worker rejoue la même publication', async () => {
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
  });

  it('refuse une publication qui vient d\'une tentative remplacée', async () => {
    const { platform, transcriptionId, runId } = await aTranscribedTranscription();
    // Le bail du premier worker s'éteint, un second reprend la transcription : le run initial
    // n'a plus le droit d'écrire.
    platform.clock.advanceSeconds(LEASE_SECONDS + 1);
    await platform.requeueStalledTranscriptions.execute();
    const second = await platform.claimNextTranscription.execute({
      workerId: 'worker-2',
      models: ['small'],
    });
    if (second === null) throw new Error('la transcription remise en file n\'a pas été réclamée');

    await expect(
      platform.assignSpeakers.execute({
        transcriptionId,
        runId,
        turns: [{ startMs: 0, endMs: 1_000, speaker: 0 }],
      }),
    ).rejects.toThrow(StaleRunError);
  });

  it('efface l\'attribution quand la diarisation ne trouve aucun tour', async () => {
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
