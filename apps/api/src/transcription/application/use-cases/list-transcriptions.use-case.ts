import type { TranscriptionCatalog, TranscriptionSummary } from '../ports/transcription-catalog';

export type ListTranscriptionsCommand = { ownerId: string };

export class ListTranscriptionsUseCase {
  constructor(private readonly catalog: TranscriptionCatalog) {}

  async execute(command: ListTranscriptionsCommand): Promise<TranscriptionSummary[]> {
    return this.catalog.listOwnedBy(command.ownerId);
  }
}
