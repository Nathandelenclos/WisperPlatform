import { TimeRange } from '../../domain/time-range';
import { TranscriptionNotFoundError } from '../errors';
import { retryOnConcurrentWrite } from '../retry-on-concurrent-write';
import type { Clock } from '../ports/clock';
import type { TranscriptionEventPublisher } from '../ports/transcription-event-publisher';
import type { TranscriptionRepository } from '../ports/transcription-repository';

export type AppendTranscribedSegmentsCommand = {
  transcriptionId: string;
  runId: string;
  batchSequence: number;
  segments: { startMs: number; endMs: number; text: string }[];
};

export class AppendTranscribedSegmentsUseCase {
  constructor(
    private readonly repository: TranscriptionRepository,
    private readonly publisher: TranscriptionEventPublisher,
    private readonly clock: Clock,
  ) {}

  async execute(command: AppendTranscribedSegmentsCommand): Promise<void> {
    // A replayed batch is already without effect thanks to `batchSequence` — this retry covers
    // the other race: the expired-lease sweeper writing the same row.
    await retryOnConcurrentWrite(async () => {
      const transcription = await this.repository.findById(command.transcriptionId);
      if (transcription === null) {
        throw new TranscriptionNotFoundError();
      }

      // whisper produces speechless segments: we drop them rather than refuse the batch.
      const segments = command.segments
        .filter((segment) => segment.text.trim().length > 0)
        .map((segment) => ({
          range: TimeRange.fromMilliseconds(segment.startMs, segment.endMs),
          text: segment.text,
        }));

      transcription.appendTranscribedSegments({
        runId: command.runId,
        batchSequence: command.batchSequence,
        segments,
        at: this.clock.now(),
      });

      // Saved even without an event: the applied batch sequence itself may have moved forward.
      await this.repository.save(transcription);
      const events = transcription.pullEvents();
      if (events.length > 0) {
        await this.publisher.publish(events);
      }
    });
  }
}
