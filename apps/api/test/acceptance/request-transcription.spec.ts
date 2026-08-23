import { describe, expect, it } from 'vitest';

import { UnsupportedModelError } from '../../src/transcription/domain/errors';

import { NOW, OWNER, aPlatform, readAll } from './platform';

describe('Scenario: a user requests the transcription of a media file', () => {
  it('puts the request in the pending state, stores the media and announces it', async () => {
    const platform = aPlatform();

    const transcriptionId = await platform.upload({
      originalName: 'entretien final.mp3',
      content: 'octets audio',
      model: 'medium',
      language: 'French',
    });

    const view = await platform.getTranscription.execute({ transcriptionId, ownerId: OWNER });
    expect(view.status).toBe('pending');
    expect(view.model).toBe('medium');
    expect(view.language).toBe('French');
    expect(view.mediaName).toBe('entretien final.mp3');
    expect(view.mediaByteSize).toBe('octets audio'.length);
    expect(view.requestedAt).toEqual(NOW);
    expect(view.segments).toEqual([]);
    expect(platform.publisher.names()).toEqual(['transcription.requested']);
  });

  it('never puts the name of the user file on disk', async () => {
    const platform = aPlatform();

    const transcriptionId = await platform.upload({
      originalName: 'entretien confidentiel.mp3',
      content: 'octets audio',
    });

    expect(platform.mediaStorage.keptKeys()).not.toContain('entretien confidentiel.mp3');
    const media = await platform.openOwnedMedia.execute({ transcriptionId, ownerId: OWNER });
    expect(await readAll(media.stream)).toBe('octets audio');
    expect(media.filename).toBe('entretien confidentiel.mp3');
    expect(media.contentType).toBe('audio/mpeg');
  });

  it('makes the request appear in the owner list', async () => {
    const platform = aPlatform();

    const transcriptionId = await platform.upload();

    const summaries = await platform.listTranscriptions.execute({ ownerId: OWNER });
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      id: transcriptionId,
      status: 'pending',
      segmentCount: 0,
      durationMs: 0,
      completedAt: null,
    });
  });

  it('refuses an unknown model without storing or recording anything', async () => {
    const platform = aPlatform();
    platform.mediaStorage.stage('/tmp/refuse', 'octets audio');

    await expect(
      platform.requestTranscription.execute({
        ownerId: OWNER,
        media: {
          tempPath: '/tmp/refuse',
          originalName: 'a.mp3',
          contentType: 'audio/mpeg',
          byteSize: 12,
        },
        model: 'enormous',
        language: 'fr',
      }),
    ).rejects.toThrow(UnsupportedModelError);

    expect(platform.mediaStorage.keptKeys()).toEqual([]);
    expect(await platform.listTranscriptions.execute({ ownerId: OWNER })).toEqual([]);
    expect(platform.publisher.published).toEqual([]);
  });
});
