import { describe, expect, it } from 'vitest';

import { TranscriptionNotFoundError } from '../../src/transcription/application/errors';

import { OTHER_OWNER, OWNER, aClaimedTranscription, aPlatform } from './platform';

describe('Scenario: a transcription that belongs to someone else is invisible', () => {
  it('does not show it, export it, hand out its media, or correct it', async () => {
    const platform = aPlatform();
    const { transcriptionId, runId } = await aClaimedTranscription(platform);
    await platform.appendTranscribedSegments.execute({
      transcriptionId,
      runId,
      batchSequence: 1,
      segments: [{ startMs: 0, endMs: 1_000, text: 'confidentiel' }],
    });
    await platform.completeTranscription.execute({ transcriptionId, runId });

    // The same error code as a resource that does not exist: nothing leaks about its existence.
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

  it('does not appear in the list of the other user', async () => {
    const platform = aPlatform();
    await platform.upload({ ownerId: OWNER, originalName: 'a-moi.mp3' });
    await platform.upload({ ownerId: OTHER_OWNER, originalName: 'a-lui.mp3' });

    const mine = await platform.listTranscriptions.execute({ ownerId: OWNER });
    const theirs = await platform.listTranscriptions.execute({ ownerId: OTHER_OWNER });

    expect(mine.map((summary) => summary.mediaName)).toEqual(['a-moi.mp3']);
    expect(theirs.map((summary) => summary.mediaName)).toEqual(['a-lui.mp3']);
  });

  it('stays not found for an identifier that does not exist', async () => {
    const platform = aPlatform();

    await expect(
      platform.getTranscription.execute({ transcriptionId: 'inconnu', ownerId: OWNER }),
    ).rejects.toThrow(TranscriptionNotFoundError);
  });
});
