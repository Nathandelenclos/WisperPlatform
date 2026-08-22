import { TranscriptionNotFoundError } from '../errors';
import type { Clock } from '../ports/clock';
import type { TranscriptionEventPublisher } from '../ports/transcription-event-publisher';
import type { TranscriptionQueue } from '../ports/transcription-queue';
import type { TranscriptionRepository } from '../ports/transcription-repository';
import { retryOnConcurrentWrite } from '../retry-on-concurrent-write';

export type ReleaseTranscriptionRunCommand = { transcriptionId: string; runId: string };

/**
 * Un worker qui s'arrête proprement rend sa tentative. Sans ça, la demande attendait
 * l'extinction du bail — deux minutes pendant lesquelles personne ne travaille dessus alors
 * qu'un autre worker est libre.
 */
export class ReleaseTranscriptionRunUseCase {
  constructor(
    private readonly repository: TranscriptionRepository,
    private readonly queue: TranscriptionQueue,
    private readonly publisher: TranscriptionEventPublisher,
    private readonly clock: Clock,
  ) {}

  async execute(command: ReleaseTranscriptionRunCommand): Promise<void> {
    await retryOnConcurrentWrite(async () => {
      const transcription = await this.repository.findById(command.transcriptionId);
      if (transcription === null) {
        throw new TranscriptionNotFoundError();
      }

      transcription.releaseRun({ runId: command.runId, at: this.clock.now() });
      await this.repository.save(transcription);
      // La demande redevient réclamable tout de suite : sans ça elle attendrait la fin de la
      // fenêtre de réservation, c'est-à-dire exactement ce qu'on cherchait à éviter.
      await this.queue.clearReservation(command.transcriptionId);
      await this.publisher.publish(transcription.pullEvents());
    });
  }
}
