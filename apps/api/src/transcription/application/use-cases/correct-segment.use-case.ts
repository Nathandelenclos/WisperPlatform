import { TranscriptionNotFoundError } from '../errors';
import { retryOnConcurrentWrite } from '../retry-on-concurrent-write';
import type { Clock } from '../ports/clock';
import type { TranscriptionEventPublisher } from '../ports/transcription-event-publisher';
import type { TranscriptionRepository } from '../ports/transcription-repository';

export type CorrectSegmentCommand = {
  transcriptionId: string;
  ownerId: string;
  ordinal: number;
  text: string;
};

export class CorrectSegmentUseCase {
  constructor(
    private readonly repository: TranscriptionRepository,
    private readonly publisher: TranscriptionEventPublisher,
    private readonly clock: Clock,
  ) {}

  async execute(command: CorrectSegmentCommand): Promise<void> {
    // Two tabs correcting the same segment start from the same state: the second one starts
    // again from a fresh read rather than losing the correction.
    await retryOnConcurrentWrite(async () => {
      const transcription = await this.repository.findById(command.transcriptionId);
      // A transcription that is not theirs is, for you, non-existent.
      if (transcription === null || transcription.ownerId !== command.ownerId) {
        throw new TranscriptionNotFoundError();
      }

      transcription.correctSegment({
        ordinal: command.ordinal,
        text: command.text,
        at: this.clock.now(),
      });
      await this.repository.save(transcription);
      await this.publisher.publish(transcription.pullEvents());
    });
  }
}
