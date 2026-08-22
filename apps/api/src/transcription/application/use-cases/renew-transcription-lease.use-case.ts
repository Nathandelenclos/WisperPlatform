import { TranscriptionNotFoundError } from '../errors';
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
    const transcription = await this.repository.findById(command.transcriptionId);
    if (transcription === null) {
      throw new TranscriptionNotFoundError();
    }

    const leaseExpiresAt = new Date(
      this.clock.now().getTime() + this.options.leaseSeconds * 1_000,
    );
    transcription.renewLease({ runId: command.runId, leaseExpiresAt });
    await this.repository.save(transcription);

    return { leaseExpiresAt };
  }
}
