import { beforeEach, describe, expect, it } from 'vitest';

import { OutOfOrderBatchError, StaleRunError } from '../../src/transcription/domain/errors';

import {
  LEASE_SECONDS,
  OWNER,
  aClaimedTranscription,
  aPlatform,
  type TranscriptionPlatform,
} from './platform';

describe('Scénario : le worker envoie ses segments au fil de l\'eau', () => {
  let platform: TranscriptionPlatform;
  let transcriptionId: string;
  let runId: string;

  beforeEach(async () => {
    platform = aPlatform();
    ({ transcriptionId, runId } = await aClaimedTranscription(platform));
  });

  it('accumule deux lots successifs et annonce chaque lot séparément', async () => {
    await platform.appendTranscribedSegments.execute({
      transcriptionId,
      runId,
      batchSequence: 1,
      segments: [
        { startMs: 0, endMs: 1_200, text: 'Bonjour à tous.' },
        { startMs: 1_200, endMs: 2_400, text: 'Merci d\'être là.' },
      ],
    });
    await platform.appendTranscribedSegments.execute({
      transcriptionId,
      runId,
      batchSequence: 2,
      segments: [{ startMs: 2_400, endMs: 4_000, text: 'Commençons.' }],
    });

    const view = await platform.getTranscription.execute({ transcriptionId, ownerId: OWNER });
    expect(view.status).toBe('transcribing');
    expect(view.segments).toEqual([
      {
        ordinal: 1,
        startMs: 0,
        endMs: 1_200,
        text: 'Bonjour à tous.',
        corrected: false,
        speakerIndex: null,
      },
      {
        ordinal: 2,
        startMs: 1_200,
        endMs: 2_400,
        text: 'Merci d\'être là.',
        corrected: false,
        speakerIndex: null,
      },
      {
        ordinal: 3,
        startMs: 2_400,
        endMs: 4_000,
        text: 'Commençons.',
        corrected: false,
        speakerIndex: null,
      },
    ]);

    expect(platform.publisher.names()).toEqual([
      'transcription.segments-appended',
      'transcription.segments-appended',
    ]);
    const [firstBatch, secondBatch] = platform.publisher.published;
    // L'instant diffusé au navigateur doit venir de l'horloge applicative, jamais de l'horloge murale.
    expect(firstBatch).toMatchObject({
      transcriptionId,
      ownerId: OWNER,
      occurredAt: platform.clock.now(),
    });
    expect(firstBatch.name === 'transcription.segments-appended' ? firstBatch.segments : []).toEqual(
      view.segments.slice(0, 2),
    );
    expect(
      secondBatch.name === 'transcription.segments-appended' ? secondBatch.segments : [],
    ).toEqual(view.segments.slice(2));
  });

  it('écarte les segments sans parole sans casser la séquence des lots', async () => {
    await platform.appendTranscribedSegments.execute({
      transcriptionId,
      runId,
      batchSequence: 1,
      segments: [{ startMs: 0, endMs: 900, text: '   ' }],
    });
    await platform.appendTranscribedSegments.execute({
      transcriptionId,
      runId,
      batchSequence: 2,
      segments: [{ startMs: 900, endMs: 1_800, text: 'Enfin quelque chose.' }],
    });

    const view = await platform.getTranscription.execute({ transcriptionId, ownerId: OWNER });
    expect(view.segments).toHaveLength(1);
    expect(view.segments[0].ordinal).toBe(1);
    expect(platform.publisher.names()).toEqual(['transcription.segments-appended']);
  });

  it('garde le bail vivant sur un signe de vie du worker', async () => {
    platform.clock.advanceSeconds(30);

    const { leaseExpiresAt } = await platform.renewTranscriptionLease.execute({
      transcriptionId,
      runId,
    });

    expect(leaseExpiresAt).toEqual(new Date(platform.clock.now().getTime() + LEASE_SECONDS * 1_000));
    expect(platform.publisher.published).toEqual([]);
  });

  it('refuse un lot venu d\'une tentative qui n\'est plus la bonne', async () => {
    await expect(
      platform.appendTranscribedSegments.execute({
        transcriptionId,
        runId: 'run-d-un-autre-worker',
        batchSequence: 1,
        segments: [{ startMs: 0, endMs: 1_000, text: 'intrus' }],
      }),
    ).rejects.toThrow(StaleRunError);
  });

  it('refuse un lot qui saute une place dans la séquence', async () => {
    await expect(
      platform.appendTranscribedSegments.execute({
        transcriptionId,
        runId,
        batchSequence: 3,
        segments: [{ startMs: 0, endMs: 1_000, text: 'trop tôt' }],
      }),
    ).rejects.toThrow(OutOfOrderBatchError);
  });
});

describe('Scénario : le worker re-poste un lot après un timeout réseau', () => {
  it('ne duplique rien et ne réannonce rien', async () => {
    const platform = aPlatform();
    const { transcriptionId, runId } = await aClaimedTranscription(platform);
    const batch = {
      transcriptionId,
      runId,
      batchSequence: 1,
      segments: [
        { startMs: 0, endMs: 1_000, text: 'un' },
        { startMs: 1_000, endMs: 2_000, text: 'deux' },
      ],
    };

    await platform.appendTranscribedSegments.execute(batch);
    await platform.appendTranscribedSegments.execute(batch);
    await platform.appendTranscribedSegments.execute(batch);

    const view = await platform.getTranscription.execute({ transcriptionId, ownerId: OWNER });
    expect(view.segments.map((segment) => segment.text)).toEqual(['un', 'deux']);
    expect(platform.publisher.names()).toEqual(['transcription.segments-appended']);
  });

  it('accepte le lot suivant comme si le rejeu n\'avait pas eu lieu', async () => {
    const platform = aPlatform();
    const { transcriptionId, runId } = await aClaimedTranscription(platform);
    const batch = {
      transcriptionId,
      runId,
      batchSequence: 1,
      segments: [{ startMs: 0, endMs: 1_000, text: 'un' }],
    };

    await platform.appendTranscribedSegments.execute(batch);
    await platform.appendTranscribedSegments.execute(batch);
    await platform.appendTranscribedSegments.execute({
      transcriptionId,
      runId,
      batchSequence: 2,
      segments: [{ startMs: 1_000, endMs: 2_000, text: 'deux' }],
    });

    const view = await platform.getTranscription.execute({ transcriptionId, ownerId: OWNER });
    expect(view.segments.map((segment) => segment.ordinal)).toEqual([1, 2]);
  });
});
