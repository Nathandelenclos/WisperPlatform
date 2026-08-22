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

/** Le propriétaire met un nom sur une voix, pour toute la transcription d'un coup. */
export class RenameSpeakerUseCase {
  constructor(
    private readonly repository: TranscriptionRepository,
    private readonly publisher: TranscriptionEventPublisher,
    private readonly clock: Clock,
  ) {}

  async execute(command: RenameSpeakerCommand): Promise<TranscriptionView> {
    // Deux onglets qui nomment deux locuteurs de la même transcription partent du même état :
    // le second repart d'une lecture fraîche plutôt que de perdre son nom.
    return retryOnConcurrentWrite(async () => {
      const transcription = await this.repository.findById(command.transcriptionId);
      // Une transcription qui n'est pas la sienne est, pour vous, inexistante.
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
