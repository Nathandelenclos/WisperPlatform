import { FakeMediaAccessTokens } from '../doubles/fake-media-access-tokens';
import { InMemoryMediaStorage } from '../doubles/in-memory-media-storage';
import { InMemoryTranscriptionCatalog } from '../doubles/in-memory-transcription-catalog';
import { InMemoryTranscriptionQueue } from '../doubles/in-memory-transcription-queue';
import { InMemoryTranscriptionRepository } from '../doubles/in-memory-transcription-repository';
import { InMemoryTranscriptionStore } from '../doubles/in-memory-transcription-store';
import { InMemoryWorkerKeyRepository } from '../doubles/in-memory-worker-key-repository';

import { describeMediaAccessTokensContract } from './media-access-tokens.contract';
import { describeMediaStorageContract } from './media-storage.contract';
import { describeTranscriptionRepositoryContract } from './transcription-repository.contract';
import { describeWorkerKeyRepositoryContract } from './worker-key-repository.contract';

describeTranscriptionRepositoryContract('in-memory doubles', async () => {
  const store = new InMemoryTranscriptionStore();
  return {
    repository: new InMemoryTranscriptionRepository(store),
    catalog: new InMemoryTranscriptionCatalog(store),
    queue: new InMemoryTranscriptionQueue(store),
    cleanup: async () => {},
  };
});

describeMediaStorageContract('in-memory double', async () => {
  const storage = new InMemoryMediaStorage();
  return {
    storage,
    stage: async (tempPath, content) => storage.stage(tempPath, content),
    tempPath: (name) => `/tmp/${name}`,
    cleanup: async () => {},
  };
});

describeMediaAccessTokensContract('signed double', () => new FakeMediaAccessTokens());

describeWorkerKeyRepositoryContract('in-memory double', async () => ({
  repository: new InMemoryWorkerKeyRepository(),
  cleanup: async () => {},
}));
