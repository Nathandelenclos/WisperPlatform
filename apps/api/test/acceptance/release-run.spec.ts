import { describe, expect, it } from 'vitest';

import { StaleRunError } from '../../src/transcription/domain/errors';

import { NOW, OWNER, SERVICE_CLAIMANT, aClaimedTranscription, aPlatform } from './platform';

describe('Scénario : un worker rend sa tentative en s\'arrêtant', () => {
  it('remet la demande en file tout de suite, sans attendre l\'extinction du bail', async () => {
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

  it('rend la demande réclamable immédiatement par un autre worker', async () => {
    const platform = aPlatform();
    const { transcriptionId, runId } = await aClaimedTranscription(platform);

    await platform.releaseTranscriptionRun.execute({ transcriptionId, runId });
    const job = await platform.claimNextTranscription.execute({
      claimant: SERVICE_CLAIMANT,
      workerId: 'worker-2',
      models: ['small'],
    });

    expect(job?.transcriptionId).toBe(transcriptionId);
    // La tentative rendue reste comptée : une machine qui redémarre en boucle finit par
    // épuiser ses essais au lieu de tourner indéfiniment sur la même demande.
    expect(job?.runId).not.toBe(runId);
  });

  it('refuse de rendre une tentative qui n\'est plus la tentative en cours', async () => {
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
