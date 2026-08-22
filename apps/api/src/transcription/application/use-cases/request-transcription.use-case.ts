import { MediaAsset } from '../../domain/media-asset';
import { Transcription } from '../../domain/transcription';
import { TranscriptionSettings } from '../../domain/transcription-settings';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { MediaStorage } from '../ports/media-storage';
import type { TranscriptionEventPublisher } from '../ports/transcription-event-publisher';
import type { TranscriptionRepository } from '../ports/transcription-repository';

export type RequestTranscriptionCommand = {
  ownerId: string;
  media: { tempPath: string; originalName: string; contentType: string; byteSize: number };
  model: string;
  language: string;
};

export class RequestTranscriptionUseCase {
  constructor(
    private readonly repository: TranscriptionRepository,
    private readonly mediaStorage: MediaStorage,
    private readonly publisher: TranscriptionEventPublisher,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(command: RequestTranscriptionCommand): Promise<{ transcriptionId: string }> {
    // On valide avant de toucher au magasin : un média n'est rangé que pour une demande recevable.
    const settings = TranscriptionSettings.of(command.model, command.language);
    const storageKey = this.idGenerator.next();
    const media = MediaAsset.stored({
      storageKey,
      originalName: command.media.originalName,
      contentType: command.media.contentType,
      byteSize: command.media.byteSize,
    });

    await this.mediaStorage.adopt({ key: storageKey, tempPath: command.media.tempPath });

    const transcription = Transcription.request({
      id: this.idGenerator.next(),
      ownerId: command.ownerId,
      media,
      settings,
      requestedAt: this.clock.now(),
    });
    await this.repository.save(transcription);
    await this.publisher.publish(transcription.pullEvents());

    return { transcriptionId: transcription.id };
  }
}
