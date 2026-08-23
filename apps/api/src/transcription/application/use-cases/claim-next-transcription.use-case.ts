import { UnsupportedModelError } from '../../domain/errors';
import { isWhisperModel, type WhisperModel } from '../../domain/transcription-settings';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { MediaAccessTokens } from '../ports/media-access-tokens';
import type { TranscriptionEventPublisher } from '../ports/transcription-event-publisher';
import type { TranscriptionQueue } from '../ports/transcription-queue';
import type { TranscriptionRepository } from '../ports/transcription-repository';
import type { Claimant } from '../ports/worker-identities';
import type { ClaimedJobView } from '../views';

export type ClaimNextTranscriptionCommand = {
  /** Who this worker works for: the queue will offer it nothing else. */
  claimant: Claimant;
  workerId: string;
  models: string[];
};

export class ClaimNextTranscriptionUseCase {
  constructor(
    private readonly repository: TranscriptionRepository,
    private readonly queue: TranscriptionQueue,
    private readonly mediaAccessTokens: MediaAccessTokens,
    private readonly publisher: TranscriptionEventPublisher,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly options: { leaseSeconds: number; reservationSeconds: number },
  ) {}

  async execute(command: ClaimNextTranscriptionCommand): Promise<ClaimedJobView | null> {
    const models: WhisperModel[] = command.models.map((model) => {
      if (!isWhisperModel(model)) {
        throw new UnsupportedModelError(`this worker announces an unknown model: ${model}`);
      }
      return model;
    });

    const now = this.clock.now();
    const reservedId = await this.queue.reserveNextPending({
      claimant: command.claimant,
      workerId: command.workerId,
      models,
      reservationSeconds: this.options.reservationSeconds,
      now,
    });
    if (reservedId === null) {
      return null;
    }

    const transcription = await this.repository.findById(reservedId);
    if (transcription === null) {
      return null;
    }

    const runId = this.idGenerator.next();
    transcription.startTranscribing({
      runId,
      workerId: command.workerId,
      leaseSeconds: this.options.leaseSeconds,
      at: now,
    });
    // The deadline is the one the aggregate set, not a second copy of the same computation.
    const leaseExpiresAt = transcription.leaseExpiry;
    if (leaseExpiresAt === null) {
      throw new Error('a run that starts always carries a lease');
    }
    await this.repository.save(transcription);
    await this.publisher.publish(transcription.pullEvents());

    return {
      transcriptionId: transcription.id,
      runId,
      model: transcription.settings.model,
      language: transcription.settings.language,
      // The pass dies with the lease: a worker that has lost its run loses its access.
      mediaToken: this.mediaAccessTokens.issue({
        transcriptionId: transcription.id,
        runId,
        expiresAt: leaseExpiresAt,
      }),
      leaseExpiresAt,
    };
  }
}
