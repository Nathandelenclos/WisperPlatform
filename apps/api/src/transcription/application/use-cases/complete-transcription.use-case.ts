import { TranscriptionNotFoundError } from '../errors';
import { retryOnConcurrentWrite } from '../retry-on-concurrent-write';
import type { Clock } from '../ports/clock';
import type { TranscriptionEventPublisher } from '../ports/transcription-event-publisher';
import type { TranscriptionRepository } from '../ports/transcription-repository';

export type CompleteTranscriptionCommand = { transcriptionId: string; runId: string };

export class CompleteTranscriptionUseCase {
  constructor(
    private readonly repository: TranscriptionRepository,
    private readonly publisher: TranscriptionEventPublisher,
    private readonly clock: Clock,
  ) {}

  async execute(command: CompleteTranscriptionCommand): Promise<void> {
    // La balayeuse des bails expirés peut écrire la même ligne au même instant.
    await retryOnConcurrentWrite(async () => {
      const transcription = await this.repository.findById(command.transcriptionId);
      if (transcription === null) {
        throw new TranscriptionNotFoundError();
      }

      transcription.complete({ runId: command.runId, at: this.clock.now() });
      await this.repository.save(transcription);
      await this.publisher.publish(transcription.pullEvents());
    });
  }
}
