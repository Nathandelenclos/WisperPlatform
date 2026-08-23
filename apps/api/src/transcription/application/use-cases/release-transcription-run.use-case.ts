import { TranscriptionNotFoundError } from '../errors';
import type { Clock } from '../ports/clock';
import type { TranscriptionEventPublisher } from '../ports/transcription-event-publisher';
import type { TranscriptionQueue } from '../ports/transcription-queue';
import type { TranscriptionRepository } from '../ports/transcription-repository';
import { retryOnConcurrentWrite } from '../retry-on-concurrent-write';

export type ReleaseTranscriptionRunCommand = { transcriptionId: string; runId: string };

/**
 * A worker that shuts down cleanly releases its run. Without this, the request waited for the
 * lease to expire — two minutes during which nobody works on it while another worker is
 * free.
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
      // The request becomes claimable again right away: without this it would wait out the
      // reservation window, that is to say exactly what we were trying to avoid.
      await this.queue.clearReservation(command.transcriptionId);
      await this.publisher.publish(transcription.pullEvents());
    });
  }
}
