import type { Readable } from 'node:stream';

import { TranscriptionNotFoundError } from '../errors';
import type { MediaStorage } from '../ports/media-storage';
import type { TranscriptionRepository } from '../ports/transcription-repository';

export type OpenOwnedMediaCommand = { transcriptionId: string; ownerId: string };

export type OpenedOwnedMedia = {
  stream: Readable;
  contentType: string;
  byteSize: number;
  filename: string;
};

export class OpenOwnedMediaUseCase {
  constructor(
    private readonly repository: TranscriptionRepository,
    private readonly mediaStorage: MediaStorage,
  ) {}

  async execute(command: OpenOwnedMediaCommand): Promise<OpenedOwnedMedia> {
    const transcription = await this.repository.findById(command.transcriptionId);
    if (transcription === null || transcription.ownerId !== command.ownerId) {
      throw new TranscriptionNotFoundError();
    }

    return {
      stream: await this.mediaStorage.openRead(transcription.media.storageKey),
      contentType: transcription.media.contentType,
      byteSize: transcription.media.byteSize,
      filename: transcription.media.originalName,
    };
  }
}
