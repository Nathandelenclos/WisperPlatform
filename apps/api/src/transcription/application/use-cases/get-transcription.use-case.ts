import { TranscriptionNotFoundError } from '../errors';
import type { TranscriptionRepository } from '../ports/transcription-repository';
import { toTranscriptionView, type TranscriptionView } from '../views';

export type GetTranscriptionCommand = { transcriptionId: string; ownerId: string };

export class GetTranscriptionUseCase {
  constructor(private readonly repository: TranscriptionRepository) {}

  async execute(command: GetTranscriptionCommand): Promise<TranscriptionView> {
    const transcription = await this.repository.findById(command.transcriptionId);
    if (transcription === null || transcription.ownerId !== command.ownerId) {
      throw new TranscriptionNotFoundError();
    }

    return toTranscriptionView(transcription.state());
  }
}
