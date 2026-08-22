import { InMemoryTranscriptionCatalog } from '../doubles/in-memory-transcription-catalog';
import { InMemoryTranscriptionQueue } from '../doubles/in-memory-transcription-queue';
import { InMemoryTranscriptionRepository } from '../doubles/in-memory-transcription-repository';
import { InMemoryTranscriptionStore } from '../doubles/in-memory-transcription-store';

import { describeTranscriptionRepositoryContract } from './transcription-repository.contract';

describeTranscriptionRepositoryContract('doubles en mémoire', async () => {
  const store = new InMemoryTranscriptionStore();
  return {
    repository: new InMemoryTranscriptionRepository(store),
    catalog: new InMemoryTranscriptionCatalog(store),
    queue: new InMemoryTranscriptionQueue(store),
    cleanup: async () => {},
  };
});
