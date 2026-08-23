import { SpeakerTurn } from '../../domain/speaker-turn';
import { TimeRange } from '../../domain/time-range';
import { TranscriptionNotFoundError } from '../errors';
import { retryOnConcurrentWrite } from '../retry-on-concurrent-write';
import type { Clock } from '../ports/clock';
import type { TranscriptionEventPublisher } from '../ports/transcription-event-publisher';
import type { TranscriptionRepository } from '../ports/transcription-repository';

export type AssignSpeakersCommand = {
  transcriptionId: string;
  runId: string;
  turns: { startMs: number; endMs: number; speaker: number }[];
};

/**
 * The worker publishes the result of its diarization pass. The pass is optional: a worker
 * that is not capable of it simply never calls this use case.
 */
export class AssignSpeakersUseCase {
  constructor(
    private readonly repository: TranscriptionRepository,
    private readonly publisher: TranscriptionEventPublisher,
    private readonly clock: Clock,
  ) {}

  async execute(command: AssignSpeakersCommand): Promise<void> {
    // Publishing is already replayable without effect — this retry covers the other race:
    // the owner correcting a segment at the moment the diarization arrives.
    await retryOnConcurrentWrite(async () => {
      const transcription = await this.repository.findById(command.transcriptionId);
      if (transcription === null) {
        throw new TranscriptionNotFoundError();
      }

      const turns = command.turns.map((turn) =>
        SpeakerTurn.of(TimeRange.fromMilliseconds(turn.startMs, turn.endMs), turn.speaker),
      );

      transcription.assignSpeakers({
        runId: command.runId,
        turns,
        at: this.clock.now(),
      });

      await this.repository.save(transcription);
      await this.publisher.publish(transcription.pullEvents());
    });
  }
}
