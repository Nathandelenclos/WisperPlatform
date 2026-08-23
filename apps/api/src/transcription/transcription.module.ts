import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { MulterModule } from '@nestjs/platform-express';
import { join } from 'node:path';

import { AuthModule } from '../auth/auth.module';
import { ENV } from '../shared/infrastructure/config/env';
import type { Env } from '../shared/infrastructure/config/env';
import { DATABASE } from '../shared/infrastructure/persistence/database';
import type { Database } from '../shared/infrastructure/persistence/database';
import { AuthenticateWorkerKeyUseCase } from '../workers/application/use-cases/authenticate-worker-key.use-case';
import { WorkersModule } from '../workers/workers.module';
import { CLOCK } from './application/ports/clock';
import type { Clock } from './application/ports/clock';
import { ID_GENERATOR } from './application/ports/id-generator';
import type { IdGenerator } from './application/ports/id-generator';
import { LOGGER } from './application/ports/logger';
import type { Logger } from './application/ports/logger';
import { MEDIA_ACCESS_TOKENS } from './application/ports/media-access-tokens';
import type { MediaAccessTokens } from './application/ports/media-access-tokens';
import { MEDIA_STORAGE } from './application/ports/media-storage';
import type { MediaStorage } from './application/ports/media-storage';
import { TRANSCRIPTION_CATALOG } from './application/ports/transcription-catalog';
import type { TranscriptionCatalog } from './application/ports/transcription-catalog';
import {
  TRANSCRIPTION_EVENT_PUBLISHER,
  TRANSCRIPTION_EVENT_STREAM,
} from './application/ports/transcription-event-publisher';
import type { TranscriptionEventPublisher } from './application/ports/transcription-event-publisher';
import { TRANSCRIPTION_QUEUE } from './application/ports/transcription-queue';
import type { TranscriptionQueue } from './application/ports/transcription-queue';
import { TRANSCRIPTION_REPOSITORY } from './application/ports/transcription-repository';
import type { TranscriptionRepository } from './application/ports/transcription-repository';
import { WORKER_IDENTITIES } from './application/ports/worker-identities';
import { AppendTranscribedSegmentsUseCase } from './application/use-cases/append-transcribed-segments.use-case';
import { AssignSpeakersUseCase } from './application/use-cases/assign-speakers.use-case';
import { ChangePlacementUseCase } from './application/use-cases/change-placement.use-case';
import { ClaimNextTranscriptionUseCase } from './application/use-cases/claim-next-transcription.use-case';
import { CompleteTranscriptionUseCase } from './application/use-cases/complete-transcription.use-case';
import { CorrectSegmentUseCase } from './application/use-cases/correct-segment.use-case';
import { ExportTranscriptionUseCase } from './application/use-cases/export-transcription.use-case';
import { FailTranscriptionUseCase } from './application/use-cases/fail-transcription.use-case';
import { GetTranscriptionUseCase } from './application/use-cases/get-transcription.use-case';
import { ListTranscriptionsUseCase } from './application/use-cases/list-transcriptions.use-case';
import { OpenMediaForRunUseCase } from './application/use-cases/open-media-for-run.use-case';
import { OpenOwnedMediaUseCase } from './application/use-cases/open-owned-media.use-case';
import { RenameSpeakerUseCase } from './application/use-cases/rename-speaker.use-case';
import { RenewTranscriptionLeaseUseCase } from './application/use-cases/renew-transcription-lease.use-case';
import { ReleaseTranscriptionRunUseCase } from './application/use-cases/release-transcription-run.use-case';
import { RequestTranscriptionUseCase } from './application/use-cases/request-transcription.use-case';
import { RequeueStalledTranscriptionsUseCase } from './application/use-cases/requeue-stalled-transcriptions.use-case';
import { InMemoryTranscriptionEvents } from './infrastructure/events/in-memory-transcription-events';
import { UuidIdGenerator } from './infrastructure/identity/uuid-id-generator';
import { createPinoLogger } from './infrastructure/logging/pino-logger';
import { DrizzleTranscriptionCatalog } from './infrastructure/persistence/drizzle-transcription-catalog';
import { DrizzleTranscriptionQueue } from './infrastructure/persistence/drizzle-transcription-queue';
import { DrizzleTranscriptionRepository } from './infrastructure/persistence/drizzle-transcription.repository';
import { HmacMediaAccessTokens } from './infrastructure/security/hmac-media-access-tokens';
import { WorkerKeyIdentities } from './infrastructure/security/worker-key-identities';
import { FilesystemMediaStorage } from './infrastructure/storage/filesystem-media-storage';
import { SystemClock } from './infrastructure/time/system-clock';
import { DomainErrorFilter } from './interface/http/domain-error.filter';
import { TranscriptionsController } from './interface/http/transcriptions.controller';
import { WorkerTokenGuard } from './interface/http/worker-token.guard';
import { WorkerJobsController } from './interface/http/worker-jobs.controller';
import { StalledTranscriptionsScheduler } from './interface/scheduling/stalled-transcriptions-scheduler';

/**
 * Duration of the purely technical reservation a worker places while it loads the aggregate.
 * It prevents two workers from claiming the same transcription and has nothing to do with the
 * business lease: a few seconds are enough.
 */
const QUEUE_RESERVATION_SECONDS = 30;

/** Maximum number of transcriptions handled per sweep of the expired leases. */
const REQUEUE_BATCH_LIMIT = 50;

/** Incoming directory for multipart uploads, before adoption by the media store. */
const INCOMING_SUBDIRECTORY = 'incoming';

/** An upload carries `file`, `model` and `language`: some headroom is enough, unbounded is not. */
const MULTIPART_MAX_FIELDS = 8;

/**
 * Composition root of the `transcription` context: the only place that knows both the ports
 * and their adapters. Everything is wired by factory, no adapter is decorated.
 */
@Module({
  imports: [
    AuthModule,
    // The `workers` context is the authority on machine keys: it is the one that says who owns
    // the key a worker presents.
    WorkersModule,
    MulterModule.registerAsync({
      useFactory: (env: Env) => ({
        dest: join(env.MEDIA_STORE_DIR, INCOMING_SUBDIRECTORY),
        limits: {
          fileSize: env.MEDIA_MAX_BYTES,
          files: 1,
          fields: MULTIPART_MAX_FIELDS,
        },
      }),
      inject: [ENV],
    }),
  ],
  controllers: [TranscriptionsController, WorkerJobsController],
  providers: [
    // --- Port adapters
    {
      provide: TRANSCRIPTION_REPOSITORY,
      useFactory: (database: Database) => new DrizzleTranscriptionRepository(database),
      inject: [DATABASE],
    },
    {
      provide: TRANSCRIPTION_CATALOG,
      useFactory: (database: Database) => new DrizzleTranscriptionCatalog(database),
      inject: [DATABASE],
    },
    {
      provide: TRANSCRIPTION_QUEUE,
      useFactory: (database: Database) => new DrizzleTranscriptionQueue(database),
      inject: [DATABASE],
    },
    {
      provide: MEDIA_STORAGE,
      useFactory: (env: Env) => new FilesystemMediaStorage(env.MEDIA_STORE_DIR),
      inject: [ENV],
    },
    {
      provide: MEDIA_ACCESS_TOKENS,
      useFactory: (env: Env) => new HmacMediaAccessTokens(env.MEDIA_TOKEN_SECRET),
      inject: [ENV],
    },
    // A single instance serves both publication and subscription: both ports point at it.
    { provide: InMemoryTranscriptionEvents, useFactory: () => new InMemoryTranscriptionEvents() },
    { provide: TRANSCRIPTION_EVENT_PUBLISHER, useExisting: InMemoryTranscriptionEvents },
    { provide: TRANSCRIPTION_EVENT_STREAM, useExisting: InMemoryTranscriptionEvents },
    { provide: CLOCK, useFactory: () => new SystemClock() },
    { provide: ID_GENERATOR, useFactory: () => new UuidIdGenerator() },
    { provide: LOGGER, useFactory: (env: Env) => createPinoLogger(env), inject: [ENV] },
    {
      provide: WORKER_IDENTITIES,
      useFactory: (env: Env, workerKeys: AuthenticateWorkerKeyUseCase) =>
        new WorkerKeyIdentities(env.WORKER_SHARED_TOKEN, workerKeys),
      inject: [ENV, AuthenticateWorkerKeyUseCase],
    },

    // --- Use cases
    {
      provide: RequestTranscriptionUseCase,
      useFactory: (
        repository: TranscriptionRepository,
        mediaStorage: MediaStorage,
        publisher: TranscriptionEventPublisher,
        clock: Clock,
        idGenerator: IdGenerator,
      ) =>
        new RequestTranscriptionUseCase(repository, mediaStorage, publisher, clock, idGenerator),
      inject: [
        TRANSCRIPTION_REPOSITORY,
        MEDIA_STORAGE,
        TRANSCRIPTION_EVENT_PUBLISHER,
        CLOCK,
        ID_GENERATOR,
      ],
    },
    {
      provide: ClaimNextTranscriptionUseCase,
      useFactory: (
        repository: TranscriptionRepository,
        queue: TranscriptionQueue,
        mediaAccessTokens: MediaAccessTokens,
        publisher: TranscriptionEventPublisher,
        clock: Clock,
        idGenerator: IdGenerator,
        env: Env,
      ) =>
        new ClaimNextTranscriptionUseCase(
          repository,
          queue,
          mediaAccessTokens,
          publisher,
          clock,
          idGenerator,
          {
            leaseSeconds: env.JOB_LEASE_SECONDS,
            reservationSeconds: QUEUE_RESERVATION_SECONDS,
          },
        ),
      inject: [
        TRANSCRIPTION_REPOSITORY,
        TRANSCRIPTION_QUEUE,
        MEDIA_ACCESS_TOKENS,
        TRANSCRIPTION_EVENT_PUBLISHER,
        CLOCK,
        ID_GENERATOR,
        ENV,
      ],
    },
    {
      provide: AppendTranscribedSegmentsUseCase,
      useFactory: (
        repository: TranscriptionRepository,
        publisher: TranscriptionEventPublisher,
        clock: Clock,
      ) => new AppendTranscribedSegmentsUseCase(repository, publisher, clock),
      inject: [TRANSCRIPTION_REPOSITORY, TRANSCRIPTION_EVENT_PUBLISHER, CLOCK],
    },
    {
      provide: AssignSpeakersUseCase,
      useFactory: (
        repository: TranscriptionRepository,
        publisher: TranscriptionEventPublisher,
        clock: Clock,
      ) => new AssignSpeakersUseCase(repository, publisher, clock),
      inject: [TRANSCRIPTION_REPOSITORY, TRANSCRIPTION_EVENT_PUBLISHER, CLOCK],
    },
    {
      provide: RenewTranscriptionLeaseUseCase,
      useFactory: (repository: TranscriptionRepository, clock: Clock, env: Env) =>
        new RenewTranscriptionLeaseUseCase(repository, clock, {
          leaseSeconds: env.JOB_LEASE_SECONDS,
        }),
      inject: [TRANSCRIPTION_REPOSITORY, CLOCK, ENV],
    },
    {
      provide: CompleteTranscriptionUseCase,
      useFactory: (
        repository: TranscriptionRepository,
        publisher: TranscriptionEventPublisher,
        clock: Clock,
      ) => new CompleteTranscriptionUseCase(repository, publisher, clock),
      inject: [TRANSCRIPTION_REPOSITORY, TRANSCRIPTION_EVENT_PUBLISHER, CLOCK],
    },
    {
      provide: FailTranscriptionUseCase,
      useFactory: (
        repository: TranscriptionRepository,
        publisher: TranscriptionEventPublisher,
        clock: Clock,
      ) => new FailTranscriptionUseCase(repository, publisher, clock),
      inject: [TRANSCRIPTION_REPOSITORY, TRANSCRIPTION_EVENT_PUBLISHER, CLOCK],
    },
    {
      provide: CorrectSegmentUseCase,
      useFactory: (
        repository: TranscriptionRepository,
        publisher: TranscriptionEventPublisher,
        clock: Clock,
      ) => new CorrectSegmentUseCase(repository, publisher, clock),
      inject: [TRANSCRIPTION_REPOSITORY, TRANSCRIPTION_EVENT_PUBLISHER, CLOCK],
    },
    {
      provide: RenameSpeakerUseCase,
      useFactory: (
        repository: TranscriptionRepository,
        publisher: TranscriptionEventPublisher,
        clock: Clock,
      ) => new RenameSpeakerUseCase(repository, publisher, clock),
      inject: [TRANSCRIPTION_REPOSITORY, TRANSCRIPTION_EVENT_PUBLISHER, CLOCK],
    },
    {
      provide: ChangePlacementUseCase,
      useFactory: (
        repository: TranscriptionRepository,
        publisher: TranscriptionEventPublisher,
        clock: Clock,
      ) => new ChangePlacementUseCase(repository, publisher, clock),
      inject: [TRANSCRIPTION_REPOSITORY, TRANSCRIPTION_EVENT_PUBLISHER, CLOCK],
    },
    {
      provide: GetTranscriptionUseCase,
      useFactory: (repository: TranscriptionRepository) =>
        new GetTranscriptionUseCase(repository),
      inject: [TRANSCRIPTION_REPOSITORY],
    },
    {
      provide: ListTranscriptionsUseCase,
      useFactory: (catalog: TranscriptionCatalog) => new ListTranscriptionsUseCase(catalog),
      inject: [TRANSCRIPTION_CATALOG],
    },
    {
      provide: ExportTranscriptionUseCase,
      useFactory: (repository: TranscriptionRepository) =>
        new ExportTranscriptionUseCase(repository),
      inject: [TRANSCRIPTION_REPOSITORY],
    },
    {
      provide: OpenOwnedMediaUseCase,
      useFactory: (repository: TranscriptionRepository, mediaStorage: MediaStorage) =>
        new OpenOwnedMediaUseCase(repository, mediaStorage),
      inject: [TRANSCRIPTION_REPOSITORY, MEDIA_STORAGE],
    },
    {
      provide: OpenMediaForRunUseCase,
      useFactory: (
        repository: TranscriptionRepository,
        mediaStorage: MediaStorage,
        mediaAccessTokens: MediaAccessTokens,
        clock: Clock,
        logger: Logger,
      ) =>
        new OpenMediaForRunUseCase(
          repository,
          mediaStorage,
          mediaAccessTokens,
          clock,
          logger,
        ),
      inject: [TRANSCRIPTION_REPOSITORY, MEDIA_STORAGE, MEDIA_ACCESS_TOKENS, CLOCK, LOGGER],
    },
    {
      provide: ReleaseTranscriptionRunUseCase,
      useFactory: (
        repository: TranscriptionRepository,
        queue: TranscriptionQueue,
        publisher: TranscriptionEventPublisher,
        clock: Clock,
      ) => new ReleaseTranscriptionRunUseCase(repository, queue, publisher, clock),
      inject: [TRANSCRIPTION_REPOSITORY, TRANSCRIPTION_QUEUE, TRANSCRIPTION_EVENT_PUBLISHER, CLOCK],
    },
    {
      provide: RequeueStalledTranscriptionsUseCase,
      useFactory: (
        repository: TranscriptionRepository,
        queue: TranscriptionQueue,
        publisher: TranscriptionEventPublisher,
        clock: Clock,
        logger: Logger,
        env: Env,
      ) =>
        new RequeueStalledTranscriptionsUseCase(repository, queue, publisher, clock, logger, {
          maxAttempts: env.JOB_MAX_ATTEMPTS,
          batchLimit: REQUEUE_BATCH_LIMIT,
        }),
      inject: [
        TRANSCRIPTION_REPOSITORY,
        TRANSCRIPTION_QUEUE,
        TRANSCRIPTION_EVENT_PUBLISHER,
        CLOCK,
        LOGGER,
        ENV,
      ],
    },

    // --- HTTP boundary
    WorkerTokenGuard,
    StalledTranscriptionsScheduler,
    { provide: APP_FILTER, useClass: DomainErrorFilter },
  ],
})
export class TranscriptionModule {}
