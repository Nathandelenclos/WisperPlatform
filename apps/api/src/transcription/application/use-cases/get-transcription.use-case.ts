import { TranscriptionNotFoundError } from '../errors';
import type { TranscriptionRepository } from '../ports/transcription-repository';
import type { TranscriptionView } from '../views';

export type GetTranscriptionCommand = { transcriptionId: string; ownerId: string };

export class GetTranscriptionUseCase {
  constructor(private readonly repository: TranscriptionRepository) {}

  async execute(command: GetTranscriptionCommand): Promise<TranscriptionView> {
    const transcription = await this.repository.findById(command.transcriptionId);
    if (transcription === null || transcription.ownerId !== command.ownerId) {
      throw new TranscriptionNotFoundError();
    }

    const state = transcription.state();
    return {
      id: state.id,
      status: state.status,
      model: state.model,
      language: state.language,
      mediaName: state.mediaOriginalName,
      mediaContentType: state.mediaContentType,
      mediaByteSize: state.mediaByteSize,
      requestedAt: state.requestedAt,
      completedAt: state.completedAt,
      failureReason: state.failureReason,
      segments: state.segments,
    };
  }
}
