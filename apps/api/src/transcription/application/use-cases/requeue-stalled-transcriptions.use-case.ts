import { ConcurrentTranscriptionWriteError } from '../errors';
import type { Clock } from '../ports/clock';
import type { Logger } from '../ports/logger';
import type { TranscriptionEventPublisher } from '../ports/transcription-event-publisher';
import type { TranscriptionQueue } from '../ports/transcription-queue';
import type { TranscriptionRepository } from '../ports/transcription-repository';

/**
 * Sweeper of abandoned transcriptions: a worker that dies leaves a lease that expires, and the
 * request goes back into the queue until its attempts are exhausted.
 */
export class RequeueStalledTranscriptionsUseCase {
  constructor(
    private readonly repository: TranscriptionRepository,
    private readonly queue: TranscriptionQueue,
    private readonly publisher: TranscriptionEventPublisher,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly options: { maxAttempts: number; batchLimit: number },
  ) {}

  async execute(): Promise<{ requeued: number }> {
    const now = this.clock.now();
    const stalled = await this.queue.findStalled({ now, limit: this.options.batchLimit });

    let requeued = 0;
    let abandoned = 0;
    for (const transcriptionId of stalled) {
      const transcription = await this.repository.findById(transcriptionId);
      if (transcription === null) {
        continue;
      }
      transcription.requeueExpiredLease({ at: now, maxAttempts: this.options.maxAttempts });
      const events = transcription.pullEvents();
      // Without an event, the lease had been renewed between the queue read and this one.
      if (events.length === 0) {
        continue;
      }
      try {
        await this.repository.save(transcription);
      } catch (error) {
        // The worker we thought dead has just written: it is the one that is right, we skip.
        // The next sweep will see the transcription again if its lease really has expired.
        if (error instanceof ConcurrentTranscriptionWriteError) {
          continue;
        }
        throw error;
      }
      await this.publisher.publish(events);
      if (events.some((event) => event.name === 'transcription.requeued')) {
        requeued += 1;
      } else {
        abandoned += 1;
      }
    }

    if (requeued + abandoned > 0) {
      this.logger.info('stalled transcriptions swept', {
        requeued,
        abandoned,
        examined: stalled.length,
      });
    }
    return { requeued };
  }
}
