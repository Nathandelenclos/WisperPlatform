import type { Readable } from 'node:stream';

import { MediaAccessDeniedError } from '../errors';
import type { Clock } from '../ports/clock';
import type { Logger } from '../ports/logger';
import type { MediaAccessTokens } from '../ports/media-access-tokens';
import type { MediaStorage } from '../ports/media-storage';
import type { TranscriptionRepository } from '../ports/transcription-repository';

export type OpenMediaForRunCommand = { token: string };

/** The worker receives the stream and its size, never the file name nor its owner. */
export type OpenedRunMedia = { stream: Readable; contentType: string; byteSize: number };

export class OpenMediaForRunUseCase {
  constructor(
    private readonly repository: TranscriptionRepository,
    private readonly mediaStorage: MediaStorage,
    private readonly mediaAccessTokens: MediaAccessTokens,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async execute(command: OpenMediaForRunCommand): Promise<OpenedRunMedia> {
    const now = this.clock.now();
    const granted = this.mediaAccessTokens.verify({ token: command.token, now });
    if (granted === null) {
      this.logger.warn('media access refused', { reason: 'invalid-token' });
      throw new MediaAccessDeniedError();
    }

    const transcription = await this.repository.findById(granted.transcriptionId);
    // A pass is only valid for the current run: it is the aggregate that says so, so that
    // access control follows the invariant if it gets stricter.
    if (transcription === null || !transcription.grantsMediaAccessTo(granted.runId)) {
      this.logger.warn('media access refused', {
        reason: 'stale-run',
        transcriptionId: granted.transcriptionId,
      });
      throw new MediaAccessDeniedError();
    }

    return {
      stream: await this.mediaStorage.openRead(transcription.media.storageKey),
      contentType: transcription.media.contentType,
      byteSize: transcription.media.byteSize,
    };
  }
}
