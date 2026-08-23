import type { Claimant } from '../../src/transcription/application/ports/worker-identities';
import { AppendTranscribedSegmentsUseCase } from '../../src/transcription/application/use-cases/append-transcribed-segments.use-case';
import { AssignSpeakersUseCase } from '../../src/transcription/application/use-cases/assign-speakers.use-case';
import { ChangePlacementUseCase } from '../../src/transcription/application/use-cases/change-placement.use-case';
import { ClaimNextTranscriptionUseCase } from '../../src/transcription/application/use-cases/claim-next-transcription.use-case';
import { CompleteTranscriptionUseCase } from '../../src/transcription/application/use-cases/complete-transcription.use-case';
import { CorrectSegmentUseCase } from '../../src/transcription/application/use-cases/correct-segment.use-case';
import { ExportTranscriptionUseCase } from '../../src/transcription/application/use-cases/export-transcription.use-case';
import { FailTranscriptionUseCase } from '../../src/transcription/application/use-cases/fail-transcription.use-case';
import { GetTranscriptionUseCase } from '../../src/transcription/application/use-cases/get-transcription.use-case';
import { ListTranscriptionsUseCase } from '../../src/transcription/application/use-cases/list-transcriptions.use-case';
import { OpenMediaForRunUseCase } from '../../src/transcription/application/use-cases/open-media-for-run.use-case';
import { OpenOwnedMediaUseCase } from '../../src/transcription/application/use-cases/open-owned-media.use-case';
import { RenameSpeakerUseCase } from '../../src/transcription/application/use-cases/rename-speaker.use-case';
import { RenewTranscriptionLeaseUseCase } from '../../src/transcription/application/use-cases/renew-transcription-lease.use-case';
import { ReleaseTranscriptionRunUseCase } from '../../src/transcription/application/use-cases/release-transcription-run.use-case';
import { RequestTranscriptionUseCase } from '../../src/transcription/application/use-cases/request-transcription.use-case';
import { RequeueStalledTranscriptionsUseCase } from '../../src/transcription/application/use-cases/requeue-stalled-transcriptions.use-case';
import { WorkerKeyIdentities } from '../../src/transcription/infrastructure/security/worker-key-identities';
import { AuthenticateWorkerKeyUseCase } from '../../src/workers/application/use-cases/authenticate-worker-key.use-case';
import { ListWorkerKeysUseCase } from '../../src/workers/application/use-cases/list-worker-keys.use-case';
import { RegisterWorkerKeyUseCase } from '../../src/workers/application/use-cases/register-worker-key.use-case';
import { RevokeWorkerKeyUseCase } from '../../src/workers/application/use-cases/revoke-worker-key.use-case';
import { NodeWorkerKeySecrets } from '../../src/workers/infrastructure/security/node-worker-key-secrets';
import { FakeMediaAccessTokens } from '../doubles/fake-media-access-tokens';
import { FixedClock } from '../doubles/fixed-clock';
import { InMemoryMediaStorage } from '../doubles/in-memory-media-storage';
import { InMemoryTranscriptionCatalog } from '../doubles/in-memory-transcription-catalog';
import { InMemoryTranscriptionQueue } from '../doubles/in-memory-transcription-queue';
import { InMemoryTranscriptionRepository } from '../doubles/in-memory-transcription-repository';
import { InMemoryTranscriptionStore } from '../doubles/in-memory-transcription-store';
import { InMemoryWorkerKeyRepository } from '../doubles/in-memory-worker-key-repository';
import { RecordingEventPublisher } from '../doubles/recording-event-publisher';
import { SequentialIdGenerator } from '../doubles/sequential-id-generator';
import { SilentLogger } from '../doubles/silent-logger';

export const LEASE_SECONDS = 60;
export const RESERVATION_SECONDS = 30;
export const MAX_ATTEMPTS = 2;
export const OWNER = 'alice';
export const OTHER_OWNER = 'bob';
export const NOW = new Date('2026-05-01T09:00:00.000Z');
/** Shared secret of the platform's workers, as the configuration would set it. */
export const SERVICE_TOKEN = 'shared-token-of-the-test-service-workers';
/** The claimant of a platform worker: what most scenarios present. */
export const SERVICE_CLAIMANT: Claimant = { kind: 'service' };

export type UploadRequest = {
  ownerId?: string;
  model?: string;
  language?: string;
  originalName?: string;
  content?: string;
  placement?: string;
};

/** Everything an acceptance scenario can drive: the use cases and the observable doubles. */
export type TranscriptionPlatform = {
  clock: FixedClock;
  mediaStorage: InMemoryMediaStorage;
  publisher: RecordingEventPublisher;
  mediaAccessTokens: FakeMediaAccessTokens;
  repository: InMemoryTranscriptionRepository;
  requestTranscription: RequestTranscriptionUseCase;
  claimNextTranscription: ClaimNextTranscriptionUseCase;
  releaseTranscriptionRun: ReleaseTranscriptionRunUseCase;
  appendTranscribedSegments: AppendTranscribedSegmentsUseCase;
  assignSpeakers: AssignSpeakersUseCase;
  renewTranscriptionLease: RenewTranscriptionLeaseUseCase;
  completeTranscription: CompleteTranscriptionUseCase;
  failTranscription: FailTranscriptionUseCase;
  correctSegment: CorrectSegmentUseCase;
  renameSpeaker: RenameSpeakerUseCase;
  getTranscription: GetTranscriptionUseCase;
  listTranscriptions: ListTranscriptionsUseCase;
  exportTranscription: ExportTranscriptionUseCase;
  openOwnedMedia: OpenOwnedMediaUseCase;
  openMediaForRun: OpenMediaForRunUseCase;
  requeueStalledTranscriptions: RequeueStalledTranscriptionsUseCase;
  changePlacement: ChangePlacementUseCase;
  registerWorkerKey: RegisterWorkerKeyUseCase;
  listWorkerKeys: ListWorkerKeysUseCase;
  revokeWorkerKey: RevokeWorkerKeyUseCase;
  /**
   * The real adapter: given a worker's bearer token, it is the one that says whether the token
   * speaks for the service, for an owner, or for nobody.
   */
  workerIdentities: WorkerKeyIdentities;
  /** Stages a media file then requests its transcription, the way the multipart upload does. */
  upload(p?: UploadRequest): Promise<string>;
};

/**
 * Platform wired on in-memory doubles: acceptance scenarios talk to the use cases the way the
 * controllers and the worker would, with no database and no HTTP.
 */
export function aPlatform(startedAt: Date = NOW): TranscriptionPlatform {
  const store = new InMemoryTranscriptionStore();
  const repository = new InMemoryTranscriptionRepository(store);
  const catalog = new InMemoryTranscriptionCatalog(store);
  const queue = new InMemoryTranscriptionQueue(store);
  const mediaStorage = new InMemoryMediaStorage();
  const mediaAccessTokens = new FakeMediaAccessTokens();
  const publisher = new RecordingEventPublisher();
  const clock = new FixedClock(startedAt);
  const idGenerator = new SequentialIdGenerator();
  const logger = new SilentLogger();
  const workerKeys = new InMemoryWorkerKeyRepository();
  // The real secrets: `node:crypto` is deterministic in what matters here (a stable fingerprint,
  // a distinct random value), and a double would only add a possible divergence.
  const workerKeySecrets = new NodeWorkerKeySecrets();

  const requestTranscription = new RequestTranscriptionUseCase(
    repository,
    mediaStorage,
    publisher,
    clock,
    idGenerator,
  );
  let uploads = 0;

  return {
    clock,
    mediaStorage,
    publisher,
    mediaAccessTokens,
    repository,
    requestTranscription,
    claimNextTranscription: new ClaimNextTranscriptionUseCase(
      repository,
      queue,
      mediaAccessTokens,
      publisher,
      clock,
      idGenerator,
      { leaseSeconds: LEASE_SECONDS, reservationSeconds: RESERVATION_SECONDS },
    ),
    appendTranscribedSegments: new AppendTranscribedSegmentsUseCase(repository, publisher, clock),
    assignSpeakers: new AssignSpeakersUseCase(repository, publisher, clock),
    releaseTranscriptionRun: new ReleaseTranscriptionRunUseCase(repository, queue, publisher, clock),
    renewTranscriptionLease: new RenewTranscriptionLeaseUseCase(repository, clock, {
      leaseSeconds: LEASE_SECONDS,
    }),
    completeTranscription: new CompleteTranscriptionUseCase(repository, publisher, clock),
    failTranscription: new FailTranscriptionUseCase(repository, publisher, clock),
    correctSegment: new CorrectSegmentUseCase(repository, publisher, clock),
    renameSpeaker: new RenameSpeakerUseCase(repository, publisher, clock),
    getTranscription: new GetTranscriptionUseCase(repository),
    listTranscriptions: new ListTranscriptionsUseCase(catalog),
    exportTranscription: new ExportTranscriptionUseCase(repository),
    openOwnedMedia: new OpenOwnedMediaUseCase(repository, mediaStorage),
    openMediaForRun: new OpenMediaForRunUseCase(
      repository,
      mediaStorage,
      mediaAccessTokens,
      clock,
      logger,
    ),
    requeueStalledTranscriptions: new RequeueStalledTranscriptionsUseCase(
      repository,
      queue,
      publisher,
      clock,
      logger,
      { maxAttempts: MAX_ATTEMPTS, batchLimit: 10 },
    ),
    changePlacement: new ChangePlacementUseCase(repository, publisher, clock),
    registerWorkerKey: new RegisterWorkerKeyUseCase(
      workerKeys,
      workerKeySecrets,
      clock,
      idGenerator,
    ),
    listWorkerKeys: new ListWorkerKeysUseCase(workerKeys),
    revokeWorkerKey: new RevokeWorkerKeyUseCase(workerKeys, clock),
    workerIdentities: new WorkerKeyIdentities(
      SERVICE_TOKEN,
      new AuthenticateWorkerKeyUseCase(workerKeys, workerKeySecrets, clock),
    ),

    async upload(p: UploadRequest = {}): Promise<string> {
      uploads += 1;
      const tempPath = `/tmp/upload-${uploads}`;
      const content = p.content ?? 'some audio bytes';
      mediaStorage.stage(tempPath, content);
      const { transcriptionId } = await requestTranscription.execute({
        ownerId: p.ownerId ?? OWNER,
        media: {
          tempPath,
          originalName: p.originalName ?? 'entretien.mp3',
          contentType: 'audio/mpeg',
          byteSize: content.length,
        },
        model: p.model ?? 'small',
        language: p.language ?? 'fr',
        placement: p.placement,
      });
      return transcriptionId;
    },
  };
}

/**
 * A media file uploaded then claimed by a worker: the starting point of most scenarios.
 * Events already published are dropped, so that each scenario only observes its own.
 */
export async function aClaimedTranscription(
  platform: TranscriptionPlatform,
  upload: UploadRequest = {},
): Promise<{ transcriptionId: string; runId: string }> {
  await platform.upload(upload);
  const job = await platform.claimNextTranscription.execute({
    claimant: SERVICE_CLAIMANT,
    workerId: 'worker-1',
    models: [upload.model ?? 'small'],
  });
  if (job === null) {
    throw new Error('the uploaded transcription was not claimed');
  }
  platform.publisher.clear();
  return { transcriptionId: job.transcriptionId, runId: job.runId };
}

/** Reads a media stream to its end, the way the worker that downloads it would. */
export async function readAll(stream: AsyncIterable<string | Buffer>): Promise<string> {
  let content = '';
  for await (const chunk of stream) {
    content += String(chunk);
  }
  return content;
}
