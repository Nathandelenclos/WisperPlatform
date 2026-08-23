import { ConcurrentTranscriptionWriteError } from '../../src/transcription/application/errors';
import type { TranscriptionRepository } from '../../src/transcription/application/ports/transcription-repository';
import { Transcription } from '../../src/transcription/domain/transcription';

import type { InMemoryTranscriptionStore } from './in-memory-transcription-store';

/**
 * In-memory repository, optimistic lock included: without it, the acceptance scenarios would
 * prove a safety under replay that the database itself refuses.
 */
export class InMemoryTranscriptionRepository implements TranscriptionRepository {
  private readonly loadedVersions = new WeakMap<Transcription, number>();

  constructor(private readonly store: InMemoryTranscriptionStore) {}

  async save(transcription: Transcription): Promise<void> {
    const state = transcription.state();
    const expectedVersion = this.loadedVersions.get(transcription) ?? null;
    const written = this.store.write(state, expectedVersion);
    if (written === null) {
      throw new ConcurrentTranscriptionWriteError(state.id);
    }
    this.loadedVersions.set(transcription, written);
  }

  async findById(id: string): Promise<Transcription | null> {
    const state = this.store.read(id);
    if (state === null) return null;
    const transcription = Transcription.restore(state);
    const version = this.store.versionOf(id);
    if (version !== null) this.loadedVersions.set(transcription, version);
    return transcription;
  }
}
