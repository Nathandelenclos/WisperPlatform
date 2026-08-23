import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import type { Env } from '../config/env';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

export type DatabaseConnection = {
  readonly db: Database;
  /** Exposed for a clean close when the application shuts down. */
  readonly pool: Pool;
};

/** Injection tokens for the connection. */
export const DATABASE = Symbol('Database');
export const DATABASE_POOL = Symbol('DatabasePool');

/**
 * Time bounds on the only outbound call the API makes. Without them, a mute database leaves a
 * query pending indefinitely, and two concurrent saves on the same transcription wait for one
 * another without limit — the client, meanwhile, stays hooked (the proxy holds for an hour).
 */
const POOL_LIMITS = {
  /** Longest wait for a free connection from the pool. */
  connectionTimeoutMillis: 5_000,
  /** A query longer than this is an incident, not slowness. */
  statement_timeout: 30_000,
  /** A row lock that does not come within 5 s fails instead of queueing up. */
  lock_timeout: 5_000,
  /** Safety net against an abandoned transaction that would keep holding its locks. */
  idle_in_transaction_session_timeout: 60_000,
  max: 10,
} as const;

/**
 * Migrator bounds: it waits little for a lock — a migration stuck behind a long transaction
 * must fail fast rather than freeze the database by holding its queue of ACCESS EXCLUSIVE
 * locks — but its own work may legitimately be long (index creation, backfill).
 */
const MIGRATION_LIMITS = {
  connectionTimeoutMillis: 10_000,
  statement_timeout: 0,
  lock_timeout: 5_000,
  idle_in_transaction_session_timeout: 0,
  max: 1,
} as const;

/**
 * The only place where a connection string is read: it comes from `Env`, never from
 * `process.env` directly. Migrations are NOT run here.
 */
export function createDatabaseConnection(env: Pick<Env, 'DATABASE_URL'>): DatabaseConnection {
  const pool = new Pool({ connectionString: env.DATABASE_URL, ...POOL_LIMITS });
  return { db: drizzle(pool, { schema }), pool };
}

/** Dedicated migrator connection: a single session, bounds specific to schema work. */
export function createMigrationConnection(
  env: Pick<Env, 'DATABASE_URL'>,
): DatabaseConnection {
  const pool = new Pool({ connectionString: env.DATABASE_URL, ...MIGRATION_LIMITS });
  return { db: drizzle(pool, { schema }), pool };
}
