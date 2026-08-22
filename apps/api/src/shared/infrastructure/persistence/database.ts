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
 * Seul endroit où une chaîne de connexion est lue : elle vient de `Env`, jamais de
 * `process.env` directement. Les migrations ne sont PAS jouées ici.
 */
export function createDatabaseConnection(env: Pick<Env, 'DATABASE_URL'>): DatabaseConnection {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  return { db: drizzle(pool, { schema }), pool };
}
