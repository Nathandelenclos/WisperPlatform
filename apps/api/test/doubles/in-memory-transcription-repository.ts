import type { TranscriptionRepository } from '../../src/transcription/application/ports/transcription-repository';
import { Transcription } from '../../src/transcription/domain/transcription';

import type { InMemoryTranscriptionStore } from './in-memory-transcription-store';

export class InMemoryTranscriptionRepository implements TranscriptionRepository {
  constructor(private readonly store: InMemoryTranscriptionStore) {}

  async save(transcription: Transcription): Promise<void> {
    this.store.write(transcription.state());
  }

  async findById(id: string): Promise<Transcription | null> {
    const state = this.store.read(id);
    return state === null ? null : Transcription.restore(state);
  }
}
