import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { DATABASE } from '../shared/infrastructure/persistence/database';
import type { Database } from '../shared/infrastructure/persistence/database';
import { CLOCK } from './application/ports/clock';
import type { Clock } from './application/ports/clock';
import { ID_GENERATOR } from './application/ports/id-generator';
import type { IdGenerator } from './application/ports/id-generator';
import { WORKER_KEY_REPOSITORY } from './application/ports/worker-key-repository';
import type { WorkerKeyRepository } from './application/ports/worker-key-repository';
import { WORKER_KEY_SECRETS } from './application/ports/worker-key-secrets';
import type { WorkerKeySecrets } from './application/ports/worker-key-secrets';
import { AuthenticateWorkerKeyUseCase } from './application/use-cases/authenticate-worker-key.use-case';
import { ListWorkerKeysUseCase } from './application/use-cases/list-worker-keys.use-case';
import { RegisterWorkerKeyUseCase } from './application/use-cases/register-worker-key.use-case';
import { RevokeWorkerKeyUseCase } from './application/use-cases/revoke-worker-key.use-case';
import { UuidIdGenerator } from './infrastructure/identity/uuid-id-generator';
import { DrizzleWorkerKeyRepository } from './infrastructure/persistence/drizzle-worker-key.repository';
import { NodeWorkerKeySecrets } from './infrastructure/security/node-worker-key-secrets';
import { SystemClock } from './infrastructure/time/system-clock';
import { WorkerKeysController } from './interface/http/worker-keys.controller';

/**
 * Racine de composition du contexte `workers` : le seul endroit qui connaisse à la fois les
 * ports et leurs adaptateurs. Tout est câblé par fabrique, aucun adaptateur n'est décoré.
 *
 * `AuthenticateWorkerKeyUseCase` est exporté : c'est ce que le contexte `transcription`
 * consomme pour savoir à qui appartient la machine qui réclame du travail.
 */
@Module({
  imports: [AuthModule],
  controllers: [WorkerKeysController],
  providers: [
    // --- Adaptateurs des ports
    {
      provide: WORKER_KEY_REPOSITORY,
      useFactory: (database: Database) => new DrizzleWorkerKeyRepository(database),
      inject: [DATABASE],
    },
    { provide: WORKER_KEY_SECRETS, useFactory: () => new NodeWorkerKeySecrets() },
    { provide: CLOCK, useFactory: () => new SystemClock() },
    { provide: ID_GENERATOR, useFactory: () => new UuidIdGenerator() },

    // --- Cas d'utilisation
    {
      provide: RegisterWorkerKeyUseCase,
      useFactory: (
        repository: WorkerKeyRepository,
        secrets: WorkerKeySecrets,
        clock: Clock,
        idGenerator: IdGenerator,
      ) => new RegisterWorkerKeyUseCase(repository, secrets, clock, idGenerator),
      inject: [WORKER_KEY_REPOSITORY, WORKER_KEY_SECRETS, CLOCK, ID_GENERATOR],
    },
    {
      provide: ListWorkerKeysUseCase,
      useFactory: (repository: WorkerKeyRepository) => new ListWorkerKeysUseCase(repository),
      inject: [WORKER_KEY_REPOSITORY],
    },
    {
      provide: RevokeWorkerKeyUseCase,
      useFactory: (repository: WorkerKeyRepository, clock: Clock) =>
        new RevokeWorkerKeyUseCase(repository, clock),
      inject: [WORKER_KEY_REPOSITORY, CLOCK],
    },
    {
      provide: AuthenticateWorkerKeyUseCase,
      useFactory: (repository: WorkerKeyRepository, secrets: WorkerKeySecrets, clock: Clock) =>
        new AuthenticateWorkerKeyUseCase(repository, secrets, clock),
      inject: [WORKER_KEY_REPOSITORY, WORKER_KEY_SECRETS, CLOCK],
    },
  ],
  exports: [AuthenticateWorkerKeyUseCase],
})
export class WorkersModule {}
