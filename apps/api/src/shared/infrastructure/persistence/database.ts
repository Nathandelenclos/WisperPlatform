import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import type { Env } from '../config/env';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

export type DatabaseConnection = {
  readonly db: Database;
  /** Exposé pour la fermeture propre à l'arrêt de l'application. */
  readonly pool: Pool;
};

/** Jetons d'injection de la connexion. */
export const DATABASE = Symbol('Database');
export const DATABASE_POOL = Symbol('DatabasePool');

/**
 * Bornes de temps du seul appel sortant de l'API. Sans elles, une base muette laisse une
 * requête pendante indéfiniment, et deux sauvegardes concurrentes sur la même transcription
 * s'attendent sans limite : le client, lui, reste accroché (le proxy tient une heure).
 */
const POOL_LIMITS = {
  /** Attente maximale d'une connexion libre du pool. */
  connectionTimeoutMillis: 5_000,
  /** Une requête plus longue que ça est un incident, pas une lenteur. */
  statement_timeout: 30_000,
  /** Un verrou de ligne qui ne vient pas en 5 s échoue au lieu de faire la queue. */
  lock_timeout: 5_000,
  /** Filet contre une transaction abandonnée qui garderait ses verrous. */
  idle_in_transaction_session_timeout: 60_000,
  max: 10,
} as const;

/**
 * Bornes du migrateur : il attend peu un verrou — une migration coincée derrière une
 * transaction longue doit échouer vite plutôt que geler la base en gardant sa file de verrous
 * ACCESS EXCLUSIVE — mais son propre travail peut être long (création d'index, backfill).
 */
const MIGRATION_LIMITS = {
  connectionTimeoutMillis: 10_000,
  statement_timeout: 0,
  lock_timeout: 5_000,
  idle_in_transaction_session_timeout: 0,
  max: 1,
} as const;

/**
 * Seul endroit où une chaîne de connexion est lue : elle vient de `Env`, jamais de
 * `process.env` directement. Les migrations ne sont PAS jouées ici.
 */
export function createDatabaseConnection(env: Pick<Env, 'DATABASE_URL'>): DatabaseConnection {
  const pool = new Pool({ connectionString: env.DATABASE_URL, ...POOL_LIMITS });
  return { db: drizzle(pool, { schema }), pool };
}

/** Connexion dédiée du migrateur : une seule session, bornes propres au travail de schéma. */
export function createMigrationConnection(
  env: Pick<Env, 'DATABASE_URL'>,
): DatabaseConnection {
  const pool = new Pool({ connectionString: env.DATABASE_URL, ...MIGRATION_LIMITS });
  return { db: drizzle(pool, { schema }), pool };
}
