import { describe, expect, it } from 'vitest';

import { ConcurrentTranscriptionWriteError } from '../../src/transcription/application/errors';
import type { TranscriptionRepository } from '../../src/transcription/application/ports/transcription-repository';
import { CorrectSegmentUseCase } from '../../src/transcription/application/use-cases/correct-segment.use-case';
import type { Transcription } from '../../src/transcription/domain/transcription';

import { OWNER, aClaimedTranscription, aPlatform } from './platform';

/**
 * Repository that refuses the first write the way a lost optimistic lock would, then behaves
 * normally. It plays the part of the other writer without having to schedule it.
 */
class ConflictOnFirstSave implements TranscriptionRepository {
  private refusals: number;

  constructor(
    private readonly delegate: TranscriptionRepository,
    refusals = 1,
  ) {
    this.refusals = refusals;
  }

  async save(transcription: Transcription): Promise<void> {
    if (this.refusals > 0) {
      this.refusals -= 1;
      throw new ConcurrentTranscriptionWriteError(transcription.id);
    }
    await this.delegate.save(transcription);
  }

  async findById(id: string): Promise<Transcription | null> {
    return this.delegate.findById(id);
  }
}

describe('Scenario: two writers touch the same transcription', () => {
  it('replays the lost correction instead of dropping it', async () => {
    const platform = aPlatform();
    const { transcriptionId, runId } = await aClaimedTranscription(platform);
    await platform.appendTranscribedSegments.execute({
      transcriptionId,
      runId,
      batchSequence: 1,
      segments: [{ startMs: 0, endMs: 1_000, text: 'bonjur' }],
    });
    await platform.completeTranscription.execute({ transcriptionId, runId });

    const correctSegment = new CorrectSegmentUseCase(
      new ConflictOnFirstSave(platform.repository),
      platform.publisher,
      platform.clock,
    );

    await correctSegment.execute({ transcriptionId, ownerId: OWNER, ordinal: 1, text: 'bonjour' });

    const view = await platform.getTranscription.execute({ transcriptionId, ownerId: OWNER });
    expect(view.segments[0]).toMatchObject({ text: 'bonjour', corrected: true });
  });

  it('gives up when the collision repeats', async () => {
    const platform = aPlatform();
    const { transcriptionId, runId } = await aClaimedTranscription(platform);
    await platform.appendTranscribedSegments.execute({
      transcriptionId,
      runId,
      batchSequence: 1,
      segments: [{ startMs: 0, endMs: 1_000, text: 'bonjur' }],
    });
    await platform.completeTranscription.execute({ transcriptionId, runId });

    const correctSegment = new CorrectSegmentUseCase(
      new ConflictOnFirstSave(platform.repository, 2),
      platform.publisher,
      platform.clock,
    );

    // A single retry: beyond that, the caller must see the conflict rather than a silence.
    await expect(
      correctSegment.execute({ transcriptionId, ownerId: OWNER, ordinal: 1, text: 'bonjour' }),
    ).rejects.toThrow(ConcurrentTranscriptionWriteError);

    const view = await platform.getTranscription.execute({ transcriptionId, ownerId: OWNER });
    expect(view.segments[0]).toMatchObject({ text: 'bonjur', corrected: false });
  });
});
