import { TranscriptionNotFoundError } from '../errors';
import { retryOnConcurrentWrite } from '../retry-on-concurrent-write';
import type { Clock } from '../ports/clock';
import type { TranscriptionRepository } from '../ports/transcription-repository';

export type RenewTranscriptionLeaseCommand = { transcriptionId: string; runId: string };

export class RenewTranscriptionLeaseUseCase {
  constructor(
    private readonly repository: TranscriptionRepository,
    private readonly clock: Clock,
    private readonly options: { leaseSeconds: number },
  ) {}

  async execute(command: RenewTranscriptionLeaseCommand): Promise<{ leaseExpiresAt: Date }> {
    return retryOnConcurrentWrite(async () => {
      const transcription = await this.repository.findById(command.transcriptionId);
      if (transcription === null) {
        throw new TranscriptionNotFoundError();
      }

      transcription.renewLease({
        runId: command.runId,
        leaseSeconds: this.options.leaseSeconds,
        at: this.clock.now(),
      });
      const leaseExpiresAt = transcription.leaseExpiry;
      if (leaseExpiresAt === null) {
        throw new Error('a renewed lease always carries a deadline');
      }
      await this.repository.save(transcription);

      return { leaseExpiresAt };
    });
  }
}
