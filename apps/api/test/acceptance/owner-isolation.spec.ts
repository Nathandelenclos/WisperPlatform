import { describe, expect, it } from 'vitest';

import { TranscriptionNotFoundError } from '../../src/transcription/application/errors';

import { OTHER_OWNER, OWNER, aClaimedTranscription, aPlatform } from './platform';

describe('Scénario : la transcription d\'autrui est invisible', () => {
  it('ne la montre pas, ne l\'exporte pas, n\'en donne pas le média et ne la corrige pas', async () => {
    const platform = aPlatform();
    const { transcriptionId, runId } = await aClaimedTranscription(platform);
    await platform.appendTranscribedSegments.execute({
      transcriptionId,
      runId,
      batchSequence: 1,
      segments: [{ startMs: 0, endMs: 1_000, text: 'confidentiel' }],
    });
    await platform.completeTranscription.execute({ transcriptionId, runId });

    // Le même code d'erreur qu'une ressource inexistante : rien ne fuit de son existence.
    await expect(
      platform.getTranscription.execute({ transcriptionId, ownerId: OTHER_OWNER }),
    ).rejects.toThrow(TranscriptionNotFoundError);
    await expect(
      platform.exportTranscription.execute({
        transcriptionId,
        ownerId: OTHER_OWNER,
        format: 'srt',
      }),
    ).rejects.toThrow(expect.objectContaining({ code: 'TRANSCRIPTION_NOT_FOUND' }));
    await expect(
      platform.openOwnedMedia.execute({ transcriptionId, ownerId: OTHER_OWNER }),
    ).rejects.toThrow(TranscriptionNotFoundError);
    await expect(
      platform.correctSegment.execute({
        transcriptionId,
        ownerId: OTHER_OWNER,
        ordinal: 1,
        text: 'je passe par là',
      }),
    ).rejects.toThrow(TranscriptionNotFoundError);
  });

  it('n\'apparaît pas dans la liste de l\'autre utilisateur', async () => {
    const platform = aPlatform();
    await platform.upload({ ownerId: OWNER, originalName: 'a-moi.mp3' });
    await platform.upload({ ownerId: OTHER_OWNER, originalName: 'a-lui.mp3' });

    const mine = await platform.listTranscriptions.execute({ ownerId: OWNER });
    const theirs = await platform.listTranscriptions.execute({ ownerId: OTHER_OWNER });

    expect(mine.map((summary) => summary.mediaName)).toEqual(['a-moi.mp3']);
    expect(theirs.map((summary) => summary.mediaName)).toEqual(['a-lui.mp3']);
  });

  it('reste introuvable pour un identifiant qui n\'existe pas', async () => {
    const platform = aPlatform();

    await expect(
      platform.getTranscription.execute({ transcriptionId: 'inconnu', ownerId: OWNER }),
    ).rejects.toThrow(TranscriptionNotFoundError);
  });
});
