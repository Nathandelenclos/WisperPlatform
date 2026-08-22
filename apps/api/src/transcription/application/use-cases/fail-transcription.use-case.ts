import { TranscriptionNotFoundError } from '../errors';
import { retryOnConcurrentWrite } from '../retry-on-concurrent-write';
import type { Clock } from '../ports/clock';
import type { TranscriptionEventPublisher } from '../ports/transcription-event-publisher';
import type { TranscriptionRepository } from '../ports/transcription-repository';

export type FailTranscriptionCommand = {
  transcriptionId: string;
  runId: string;
  reason: string;
};

export class FailTranscriptionUseCase {
  constructor(
    private readonly repository: TranscriptionRepository,
    private readonly publisher: TranscriptionEventPublisher,
    private readonly clock: Clock,
  ) {}

  async execute(command: FailTranscriptionCommand): Promise<void> {
    // Même course que la complétion : la balayeuse peut avoir remis le travail en file.
    await retryOnConcurrentWrite(async () => {
      const transcription = await this.repository.findById(command.transcriptionId);
      if (transcription === null) {
        throw new TranscriptionNotFoundError();
      }

      transcription.fail({
        runId: command.runId,
        reason: command.reason,
        at: this.clock.now(),
      });
      await this.repository.save(transcription);
      await this.publisher.publish(transcription.pullEvents());
    });
  }
}
