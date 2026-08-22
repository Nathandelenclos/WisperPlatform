import { TimeRange } from '../../domain/time-range';
import { TranscriptionNotFoundError } from '../errors';
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
  ) {}

  async execute(command: AppendTranscribedSegmentsCommand): Promise<void> {
    const transcription = await this.repository.findById(command.transcriptionId);
    if (transcription === null) {
      throw new TranscriptionNotFoundError();
    }

    // whisper produit des segments sans parole : on les écarte plutôt que de refuser le lot.
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
    });

    // Enregistré même sans événement : la séquence de lots appliquée, elle, a pu avancer.
    await this.repository.save(transcription);
    const events = transcription.pullEvents();
    if (events.length > 0) {
      await this.publisher.publish(events);
    }
  }
}
