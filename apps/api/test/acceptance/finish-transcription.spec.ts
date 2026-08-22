import { describe, expect, it } from 'vitest';

import { StaleRunError } from '../../src/transcription/domain/errors';

import { NOW, OWNER, aClaimedTranscription, aPlatform } from './platform';

describe('Scénario : le worker achève une transcription', () => {
  it('la déclare achevée, annonce la fin et la rend corrigeable', async () => {
    const platform = aPlatform();
    const { transcriptionId, runId } = await aClaimedTranscription(platform);
    await platform.appendTranscribedSegments.execute({
      transcriptionId,
      runId,
      batchSequence: 1,
      segments: [{ startMs: 0, endMs: 2_000, text: 'Tout est dit.' }],
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

  it('accepte un média sans aucune parole', async () => {
    const platform = aPlatform();
    const { transcriptionId, runId } = await aClaimedTranscription(platform);

    await platform.completeTranscription.execute({ transcriptionId, runId });

    const summaries = await platform.listTranscriptions.execute({ ownerId: OWNER });
    expect(summaries[0]).toMatchObject({ status: 'completed', segmentCount: 0, durationMs: 0 });
  });

  it('refuse une fin annoncée par une tentative qui n\'est plus la bonne', async () => {
    const platform = aPlatform();
    const { transcriptionId } = await aClaimedTranscription(platform);

    await expect(
      platform.completeTranscription.execute({ transcriptionId, runId: 'un-autre-run' }),
    ).rejects.toThrow(StaleRunError);
  });
});

describe('Scénario : le worker signale un échec', () => {
  it('marque l\'échec, en retient la raison et l\'annonce', async () => {
    const platform = aPlatform();
    const { transcriptionId, runId } = await aClaimedTranscription(platform);

    await platform.failTranscription.execute({
      transcriptionId,
      runId,
      reason: 'whisper a quitté avec le code 137',
    });

    const view = await platform.getTranscription.execute({ transcriptionId, ownerId: OWNER });
    expect(view.status).toBe('failed');
    expect(view.failureReason).toBe('whisper a quitté avec le code 137');
    expect(platform.publisher.published).toEqual([
      {
        name: 'transcription.failed',
        transcriptionId,
        ownerId: OWNER,
        reason: 'whisper a quitté avec le code 137',
        occurredAt: NOW,
      },
    ]);
  });

  it('rend la transcription échouée visible dans la liste du propriétaire', async () => {
    const platform = aPlatform();
    const { transcriptionId, runId } = await aClaimedTranscription(platform);

    await platform.failTranscription.execute({ transcriptionId, runId, reason: 'média illisible' });

    const summaries = await platform.listTranscriptions.execute({ ownerId: OWNER });
    expect(summaries[0]).toMatchObject({
      status: 'failed',
      failureReason: 'média illisible',
      completedAt: null,
    });
  });

  it('n\'accepte pas un échec après la fin du travail', async () => {
    const platform = aPlatform();
    const { transcriptionId, runId } = await aClaimedTranscription(platform);
    await platform.completeTranscription.execute({ transcriptionId, runId });

    await expect(
      platform.failTranscription.execute({ transcriptionId, runId, reason: 'trop tard' }),
    ).rejects.toThrow(expect.objectContaining({ code: 'ILLEGAL_TRANSCRIPTION_STATE' }));
  });
});
