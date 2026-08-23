import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, describe, expect, it } from 'vitest';

import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '../../src/shared/infrastructure/persistence/database';
import { runMigrations } from '../../src/shared/infrastructure/persistence/migrate';
import {
  transcriptionSegments,
  transcriptionSpeakers,
  transcriptions,
  user,
  workerKeys,
} from '../../src/shared/infrastructure/persistence/schema';
import { DrizzleTranscriptionCatalog } from '../../src/transcription/infrastructure/persistence/drizzle-transcription-catalog';
import { DrizzleTranscriptionQueue } from '../../src/transcription/infrastructure/persistence/drizzle-transcription-queue';
import { DrizzleTranscriptionRepository } from '../../src/transcription/infrastructure/persistence/drizzle-transcription.repository';
import { MediaAsset } from '../../src/transcription/domain/media-asset';
import { Transcription } from '../../src/transcription/domain/transcription';
import { TranscriptionSettings } from '../../src/transcription/domain/transcription-settings';
import { DrizzleWorkerKeyRepository } from '../../src/workers/infrastructure/persistence/drizzle-worker-key.repository';
import {
  CONTRACT_OWNER_A,
  CONTRACT_OWNER_B,
  describeTranscriptionRepositoryContract,
} from '../contracts/transcription-repository.contract';
import { describeWorkerKeyRepositoryContract } from '../contracts/worker-key-repository.contract';

// Même image que le compose, digest figé : la persistance doit être vérifiée contre
// exactement le Postgres qui tourne en production, sans dérive entre deux exécutions.
const POSTGRES_IMAGE =
  'postgres:17-alpine@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73';
const POSTGRES_USER = 'wisper';
const POSTGRES_PASSWORD = 'wisper-test';
const POSTGRES_DB = 'wisper_test';

type Harness = {
  readonly container: StartedTestContainer;
  readonly connection: DatabaseConnection;
};

/**
 * Un seul conteneur pour tout le fichier : démarrer Postgres coûte des secondes, et les
 * suites se nettoient entre elles par `truncate`.
 */
let harness: Promise<Harness> | undefined;

async function startPostgres(): Promise<Harness> {
  const container = await new GenericContainer(POSTGRES_IMAGE)
    .withEnvironment({
      POSTGRES_USER,
      POSTGRES_PASSWORD,
      POSTGRES_DB,
    })
    .withExposedPorts(5432)
    // L'image journalise deux fois « ready to accept connections » : une fois pendant
    // l'initialisation du cluster, une fois pour de bon.
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();

  const databaseUrl = `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${container.getHost()}:${container.getMappedPort(
    5432,
  )}/${POSTGRES_DB}`;

  // On joue les migrations versionnées, pas un `push` du schéma : c'est le SQL de production
  // qui est vérifié ici.
  await runMigrations({ DATABASE_URL: databaseUrl });

  const connection = createDatabaseConnection({ DATABASE_URL: databaseUrl });

  // Les propriétaires utilisés par la suite de contrat doivent exister : `owner_id` porte une
  // clé étrangère vers `user`.
  const now = new Date('2024-01-01T00:00:00.000Z');
  await connection.db
    .insert(user)
    .values(
      [CONTRACT_OWNER_A, CONTRACT_OWNER_B].map((id, position) => ({
        id,
        name: `owner-${position}`,
        email: `owner-${position}@example.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoNothing();

  return { container, connection };
}

function postgres(): Promise<Harness> {
  harness ??= startPostgres();
  return harness;
}

async function truncateTranscriptions(connection: DatabaseConnection): Promise<void> {
  await connection.db.execute(
    sql`truncate table ${transcriptionSegments}, ${transcriptionSpeakers}, ${transcriptions} cascade`,
  );
}

describeTranscriptionRepositoryContract('drizzle sur Postgres', async () => {
  const { connection } = await postgres();
  return {
    repository: new DrizzleTranscriptionRepository(connection.db),
    catalog: new DrizzleTranscriptionCatalog(connection.db),
    queue: new DrizzleTranscriptionQueue(connection.db),
    cleanup: () => truncateTranscriptions(connection),
  };
});

describeWorkerKeyRepositoryContract('drizzle sur Postgres', async () => {
  const { connection } = await postgres();
  return {
    repository: new DrizzleWorkerKeyRepository(connection.db),
    cleanup: async () => {
      await connection.db.execute(sql`truncate table ${workerKeys} cascade`);
    },
  };
});

describe('réservation concurrente sur Postgres', () => {
  it("ne rend une transcription en attente qu'à un seul des workers en concurrence", async () => {
    const { connection } = await postgres();
    await truncateTranscriptions(connection);

    const repository = new DrizzleTranscriptionRepository(connection.db);
    const queue = new DrizzleTranscriptionQueue(connection.db);

    const transcriptionId = randomUUID();
    await repository.save(
      Transcription.request({
        id: transcriptionId,
        ownerId: CONTRACT_OWNER_A,
        media: MediaAsset.stored({
          storageKey: randomUUID(),
          originalName: 'interview.mp3',
          contentType: 'audio/mpeg',
          byteSize: 1_234_567,
        }),
        settings: TranscriptionSettings.of('small', 'fr'),
        requestedAt: new Date('2024-05-01T10:00:00.000Z'),
      }),
    );

    const now = new Date('2024-05-01T10:00:05.000Z');
    // Quatre réservations réellement simultanées, chacune sur sa propre connexion du pool :
    // c'est `for update skip locked` qui doit trancher, pas l'ordonnancement.
    const outcomes = await Promise.all(
      ['worker-a', 'worker-b', 'worker-c', 'worker-d'].map((workerId) =>
        queue.reserveNextPending({
          claimant: { kind: 'service' },
          workerId,
          models: ['small'],
          reservationSeconds: 60,
          now,
        }),
      ),
    );

    const reserved = outcomes.filter((outcome) => outcome !== null);
    expect(reserved).toEqual([transcriptionId]);
    expect(outcomes.filter((outcome) => outcome === null)).toHaveLength(3);
  });
});

afterAll(async () => {
  if (!harness) return;
  const { container, connection } = await harness;
  await connection.pool.end();
  await container.stop();
});
