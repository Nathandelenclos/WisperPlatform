import type { Readable } from 'node:stream';

import { MediaAccessDeniedError } from '../errors';
import type { Clock } from '../ports/clock';
import type { Logger } from '../ports/logger';
import type { MediaAccessTokens } from '../ports/media-access-tokens';
import type { MediaStorage } from '../ports/media-storage';
import type { TranscriptionRepository } from '../ports/transcription-repository';

export type OpenMediaForRunCommand = { token: string };

/** Le worker reçoit le flux et sa taille, jamais le nom du fichier ni son propriétaire. */
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
    // Un laissez-passer ne vaut que pour la tentative en cours : dès qu'elle est remplacée,
    // achevée ou échouée, il ne donne plus rien.
    const state = transcription === null ? null : transcription.state();
    if (
      transcription === null ||
      state === null ||
      state.status !== 'transcribing' ||
      state.currentRunId !== granted.runId
    ) {
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
