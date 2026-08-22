import { AppendTranscribedSegmentsUseCase } from '../../src/transcription/application/use-cases/append-transcribed-segments.use-case';
import { ClaimNextTranscriptionUseCase } from '../../src/transcription/application/use-cases/claim-next-transcription.use-case';
import { CompleteTranscriptionUseCase } from '../../src/transcription/application/use-cases/complete-transcription.use-case';
import { CorrectSegmentUseCase } from '../../src/transcription/application/use-cases/correct-segment.use-case';
import { ExportTranscriptionUseCase } from '../../src/transcription/application/use-cases/export-transcription.use-case';
import { FailTranscriptionUseCase } from '../../src/transcription/application/use-cases/fail-transcription.use-case';
import { GetTranscriptionUseCase } from '../../src/transcription/application/use-cases/get-transcription.use-case';
import { ListTranscriptionsUseCase } from '../../src/transcription/application/use-cases/list-transcriptions.use-case';
import { OpenMediaForRunUseCase } from '../../src/transcription/application/use-cases/open-media-for-run.use-case';
import { OpenOwnedMediaUseCase } from '../../src/transcription/application/use-cases/open-owned-media.use-case';
import { RenewTranscriptionLeaseUseCase } from '../../src/transcription/application/use-cases/renew-transcription-lease.use-case';
import { RequestTranscriptionUseCase } from '../../src/transcription/application/use-cases/request-transcription.use-case';
import { RequeueStalledTranscriptionsUseCase } from '../../src/transcription/application/use-cases/requeue-stalled-transcriptions.use-case';
import { FakeMediaAccessTokens } from '../doubles/fake-media-access-tokens';
import { FixedClock } from '../doubles/fixed-clock';
import { InMemoryMediaStorage } from '../doubles/in-memory-media-storage';
import { InMemoryTranscriptionCatalog } from '../doubles/in-memory-transcription-catalog';
import { InMemoryTranscriptionQueue } from '../doubles/in-memory-transcription-queue';
import { InMemoryTranscriptionRepository } from '../doubles/in-memory-transcription-repository';
import { InMemoryTranscriptionStore } from '../doubles/in-memory-transcription-store';
import { RecordingEventPublisher } from '../doubles/recording-event-publisher';
import { SequentialIdGenerator } from '../doubles/sequential-id-generator';
import { SilentLogger } from '../doubles/silent-logger';

export const LEASE_SECONDS = 60;
export const RESERVATION_SECONDS = 30;
export const MAX_ATTEMPTS = 2;
export const OWNER = 'alice';
export const OTHER_OWNER = 'bob';
export const NOW = new Date('2026-05-01T09:00:00.000Z');

export type UploadRequest = {
  ownerId?: string;
  model?: string;
  language?: string;
  originalName?: string;
  content?: string;
};

/** Tout ce qu'un scénario d'acceptation peut piloter : les use cases et les doubles témoins. */
export type TranscriptionPlatform = {
  clock: FixedClock;
  mediaStorage: InMemoryMediaStorage;
  publisher: RecordingEventPublisher;
  mediaAccessTokens: FakeMediaAccessTokens;
  repository: InMemoryTranscriptionRepository;
  requestTranscription: RequestTranscriptionUseCase;
  claimNextTranscription: ClaimNextTranscriptionUseCase;
  appendTranscribedSegments: AppendTranscribedSegmentsUseCase;
  renewTranscriptionLease: RenewTranscriptionLeaseUseCase;
  completeTranscription: CompleteTranscriptionUseCase;
  failTranscription: FailTranscriptionUseCase;
  correctSegment: CorrectSegmentUseCase;
  getTranscription: GetTranscriptionUseCase;
  listTranscriptions: ListTranscriptionsUseCase;
  exportTranscription: ExportTranscriptionUseCase;
  openOwnedMedia: OpenOwnedMediaUseCase;
  openMediaForRun: OpenMediaForRunUseCase;
  requeueStalledTranscriptions: RequeueStalledTranscriptionsUseCase;
  /** Dépose un média puis demande sa transcription, comme le fait l'upload multipart. */
  upload(p?: UploadRequest): Promise<string>;
};

/**
 * Plateforme montée sur des doubles en mémoire : les scénarios d'acceptation parlent aux use
 * cases comme le feraient les controllers et le worker, sans base ni HTTP.
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
    renewTranscriptionLease: new RenewTranscriptionLeaseUseCase(repository, clock, {
      leaseSeconds: LEASE_SECONDS,
    }),
    completeTranscription: new CompleteTranscriptionUseCase(repository, publisher, clock),
    failTranscription: new FailTranscriptionUseCase(repository, publisher, clock),
    correctSegment: new CorrectSegmentUseCase(repository, publisher, clock),
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

    async upload(p: UploadRequest = {}): Promise<string> {
      uploads += 1;
      const tempPath = `/tmp/upload-${uploads}`;
      const content = p.content ?? 'des octets audio';
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
      });
      return transcriptionId;
    },
  };
}

/**
 * Un média déposé puis réclamé par un worker : point de départ de la plupart des scénarios.
 * Les événements déjà publiés sont oubliés, pour que chaque scénario n'observe que les siens.
 */
export async function aClaimedTranscription(
  platform: TranscriptionPlatform,
  upload: UploadRequest = {},
): Promise<{ transcriptionId: string; runId: string }> {
  await platform.upload(upload);
  const job = await platform.claimNextTranscription.execute({
    workerId: 'worker-1',
    models: [upload.model ?? 'small'],
  });
  if (job === null) {
    throw new Error('la transcription déposée n\'a pas été réclamée');
  }
  platform.publisher.clear();
  return { transcriptionId: job.transcriptionId, runId: job.runId };
}

/** Lit un flux de média jusqu'au bout, comme le ferait le worker qui télécharge. */
export async function readAll(stream: AsyncIterable<string | Buffer>): Promise<string> {
  let content = '';
  for await (const chunk of stream) {
    content += String(chunk);
  }
  return content;
}
