import { toPlacement } from '../../domain/placement';
import { TranscriptionNotFoundError } from '../errors';
import { retryOnConcurrentWrite } from '../retry-on-concurrent-write';
import type { Clock } from '../ports/clock';
import type { TranscriptionEventPublisher } from '../ports/transcription-event-publisher';
import type { TranscriptionRepository } from '../ports/transcription-repository';
import { toTranscriptionView, type TranscriptionView } from '../views';

export type ChangePlacementCommand = {
  transcriptionId: string;
  ownerId: string;
  placement: string;
};

/**
 * The owner decides where their request will be computed. That is what lets them hand back to
 * the service a request that their machine, switched off, leaves pending — and the decision
 * stays theirs: the platform never pulls anything back on its own.
 */
export class ChangePlacementUseCase {
  constructor(
    private readonly repository: TranscriptionRepository,
    private readonly publisher: TranscriptionEventPublisher,
    private readonly clock: Clock,
  ) {}

  async execute(command: ChangePlacementCommand): Promise<TranscriptionView> {
    const placement = toPlacement(command.placement);

    // A worker may claim the request at that very instant: the second attempt starts again
    // from a fresh read and will then refuse the move, instead of overwriting its start.
    return retryOnConcurrentWrite(async () => {
      const transcription = await this.repository.findById(command.transcriptionId);
      // A transcription that is not theirs is, for them, non-existent.
      if (transcription === null || transcription.ownerId !== command.ownerId) {
        throw new TranscriptionNotFoundError();
      }

      transcription.changePlacement({ placement, at: this.clock.now() });
      await this.repository.save(transcription);
      await this.publisher.publish(transcription.pullEvents());
      return toTranscriptionView(transcription.state());
    });
  }
}
