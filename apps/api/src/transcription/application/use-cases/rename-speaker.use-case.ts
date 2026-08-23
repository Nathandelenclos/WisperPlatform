import { TranscriptionNotFoundError } from '../errors';
import { retryOnConcurrentWrite } from '../retry-on-concurrent-write';
import type { Clock } from '../ports/clock';
import type { TranscriptionEventPublisher } from '../ports/transcription-event-publisher';
import type { TranscriptionRepository } from '../ports/transcription-repository';
import { toTranscriptionView, type TranscriptionView } from '../views';

export type RenameSpeakerCommand = {
  transcriptionId: string;
  ownerId: string;
  index: number;
  name: string;
};

/** The owner puts a name on a voice, for the whole transcription in one go. */
export class RenameSpeakerUseCase {
  constructor(
    private readonly repository: TranscriptionRepository,
    private readonly publisher: TranscriptionEventPublisher,
    private readonly clock: Clock,
  ) {}

  async execute(command: RenameSpeakerCommand): Promise<TranscriptionView> {
    // Two tabs naming two speakers of the same transcription start from the same state:
    // the second one starts again from a fresh read rather than losing its name.
    return retryOnConcurrentWrite(async () => {
      const transcription = await this.repository.findById(command.transcriptionId);
      // A transcription that is not theirs is, for you, non-existent.
      if (transcription === null || transcription.ownerId !== command.ownerId) {
        throw new TranscriptionNotFoundError();
      }

      transcription.renameSpeaker({
        index: command.index,
        name: command.name,
        at: this.clock.now(),
      });
      await this.repository.save(transcription);
      await this.publisher.publish(transcription.pullEvents());
      return toTranscriptionView(transcription.state());
    });
  }
}
