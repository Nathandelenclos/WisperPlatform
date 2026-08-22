import { TranscriptionNotFoundError } from '../errors';
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
    const transcription = await this.repository.findById(command.transcriptionId);
    // Une transcription qui n'est pas la sienne est, pour vous, inexistante.
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
  }
}
