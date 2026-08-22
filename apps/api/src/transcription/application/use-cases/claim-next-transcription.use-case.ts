import { UnsupportedModelError } from '../../domain/errors';
import { isWhisperModel, type WhisperModel } from '../../domain/transcription-settings';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { MediaAccessTokens } from '../ports/media-access-tokens';
import type { TranscriptionEventPublisher } from '../ports/transcription-event-publisher';
import type { TranscriptionQueue } from '../ports/transcription-queue';
import type { TranscriptionRepository } from '../ports/transcription-repository';
import type { ClaimedJobView } from '../views';

export type ClaimNextTranscriptionCommand = { workerId: string; models: string[] };

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
        throw new UnsupportedModelError(`ce worker annonce un modèle inconnu : ${model}`);
      }
      return model;
    });

    const now = this.clock.now();
    const reservedId = await this.queue.reserveNextPending({
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
    // L'échéance est celle que l'aggregate a posée, pas une seconde copie du même calcul.
    const leaseExpiresAt = transcription.leaseExpiry;
    if (leaseExpiresAt === null) {
      throw new Error('une tentative qui démarre porte toujours un bail');
    }
    await this.repository.save(transcription);
    await this.publisher.publish(transcription.pullEvents());

    return {
      transcriptionId: transcription.id,
      runId,
      model: transcription.settings.model,
      language: transcription.settings.language,
      // Le laissez-passer meurt avec le bail : un worker qui a perdu son run perd son accès.
      mediaToken: this.mediaAccessTokens.issue({
        transcriptionId: transcription.id,
        runId,
        expiresAt: leaseExpiresAt,
      }),
      leaseExpiresAt,
    };
  }
}
