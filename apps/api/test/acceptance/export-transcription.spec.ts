import { describe, expect, it } from 'vitest';

import { OWNER, aClaimedTranscription, aPlatform } from './platform';

describe('Scénario : le propriétaire exporte ses sous-titres', () => {
  it('rend un fichier SRT nommé d\'après le média, corrections comprises', async () => {
    const platform = aPlatform();
    const { transcriptionId, runId } = await aClaimedTranscription(platform, {
      originalName: 'conference plénière.mp3',
    });
    await platform.appendTranscribedSegments.execute({
      transcriptionId,
      runId,
      batchSequence: 1,
      segments: [
        { startMs: 0, endMs: 2_500, text: 'bonjur à tous' },
        { startMs: 2_500, endMs: 3_661_234, text: 'Et bienvenue.' },
      ],
    });
    await platform.completeTranscription.execute({ transcriptionId, runId });
    await platform.correctSegment.execute({
      transcriptionId,
      ownerId: OWNER,
      ordinal: 1,
      text: 'Bonjour à tous',
    });

    const exported = await platform.exportTranscription.execute({
      transcriptionId,
      ownerId: OWNER,
      format: 'srt',
    });

    expect(exported.filename).toBe('conference plénière.srt');
    expect(exported.contentType).toBe('application/x-subrip; charset=utf-8');
    expect(exported.body).toBe(
      '1\n' +
        '00:00:00,000 --> 00:00:02,500\n' +
        'Bonjour à tous\n' +
        '\n' +
        '2\n' +
        '00:00:02,500 --> 01:01:01,234\n' +
        'Et bienvenue.\n',
    );
  });

  it('rend aussi le WebVTT et le texte brut du même contenu', async () => {
    const platform = aPlatform();
    const { transcriptionId, runId } = await aClaimedTranscription(platform);
    await platform.appendTranscribedSegments.execute({
      transcriptionId,
      runId,
      batchSequence: 1,
      segments: [{ startMs: 0, endMs: 1_000, text: 'Un seul segment.' }],
    });
    await platform.completeTranscription.execute({ transcriptionId, runId });

    const vtt = await platform.exportTranscription.execute({
      transcriptionId,
      ownerId: OWNER,
      format: 'vtt',
    });
    const txt = await platform.exportTranscription.execute({
      transcriptionId,
      ownerId: OWNER,
      format: 'txt',
    });

    expect(vtt.filename).toBe('entretien.vtt');
    expect(vtt.contentType).toBe('text/vtt; charset=utf-8');
    expect(vtt.body).toBe('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nUn seul segment.\n');
    expect(txt.filename).toBe('entretien.txt');
    expect(txt.contentType).toBe('text/plain; charset=utf-8');
    expect(txt.body).toBe('Un seul segment.\n');
  });
});
