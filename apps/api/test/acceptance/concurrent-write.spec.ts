import { describe, expect, it } from 'vitest';

import { ConcurrentTranscriptionWriteError } from '../../src/transcription/application/errors';
import type { TranscriptionRepository } from '../../src/transcription/application/ports/transcription-repository';
import { CorrectSegmentUseCase } from '../../src/transcription/application/use-cases/correct-segment.use-case';
import type { Transcription } from '../../src/transcription/domain/transcription';

import { OWNER, aClaimedTranscription, aPlatform } from './platform';

/**
 * Dépôt qui refuse la première écriture comme le ferait un verrou optimiste perdu, puis se
 * comporte normalement. Il tient le rôle de l'autre écrivain sans avoir à l'ordonnancer.
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

describe('Scénario : deux écrivains touchent la même transcription', () => {
  it('rejoue la correction perdue au lieu de l\'abandonner', async () => {
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

  it('abandonne quand la collision se répète', async () => {
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

    // Un seul nouvel essai : au-delà, l'appelant doit voir le conflit plutôt qu'un silence.
    await expect(
      correctSegment.execute({ transcriptionId, ownerId: OWNER, ordinal: 1, text: 'bonjour' }),
    ).rejects.toThrow(ConcurrentTranscriptionWriteError);

    const view = await platform.getTranscription.execute({ transcriptionId, ownerId: OWNER });
    expect(view.segments[0]).toMatchObject({ text: 'bonjur', corrected: false });
  });
});
