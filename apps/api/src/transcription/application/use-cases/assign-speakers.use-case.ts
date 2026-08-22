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
 * Le worker publie le résultat de sa passe de diarisation. La passe est optionnelle : un
 * worker qui n'en est pas capable n'appelle simplement jamais ce cas d'utilisation.
 */
export class AssignSpeakersUseCase {
  constructor(
    private readonly repository: TranscriptionRepository,
    private readonly publisher: TranscriptionEventPublisher,
    private readonly clock: Clock,
  ) {}

  async execute(command: AssignSpeakersCommand): Promise<void> {
    // La publication est déjà rejouable sans effet ; ce nouvel essai couvre l'autre course :
    // le propriétaire qui corrige un segment au moment où la diarisation arrive.
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
