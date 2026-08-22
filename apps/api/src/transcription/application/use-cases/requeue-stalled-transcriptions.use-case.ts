import { ConcurrentTranscriptionWriteError } from '../errors';
import type { Clock } from '../ports/clock';
import type { Logger } from '../ports/logger';
import type { TranscriptionEventPublisher } from '../ports/transcription-event-publisher';
import type { TranscriptionQueue } from '../ports/transcription-queue';
import type { TranscriptionRepository } from '../ports/transcription-repository';

/**
 * Balayeuse des transcriptions abandonnées : un worker qui meurt laisse un bail qui s'éteint,
 * la demande repart en file jusqu'à épuisement des tentatives.
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
      // Sans événement, le bail avait été renouvelé entre la lecture de la file et celle-ci.
      if (events.length === 0) {
        continue;
      }
      try {
        await this.repository.save(transcription);
      } catch (error) {
        // Le worker que l'on croyait mort vient d'écrire : c'est lui qui a raison, on passe.
        // Le prochain balayage reverra la transcription si son bail est réellement éteint.
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
