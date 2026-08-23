import { join } from 'node:path';

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { z } from 'zod';

import type { Env } from '../config/env';
import { createMigrationConnection } from './database';

/**
 * The migrator consumes nothing but a connection string: it therefore validates that one
 * setting alone. Validating the whole environment would force its container to hold the
 * session and media-token secrets, which a SQL migration has no use for.
 */
const migrationEnvSchema = z.object({ DATABASE_URL: z.string().trim().min(1) });

/**
 * Folder holding the versioned migrations. The computation lands on `apps/api/` from
 * `src/shared/infrastructure/persistence` (tsx) as well as from
 * `dist/shared/infrastructure/persistence`.
 */
export const MIGRATIONS_FOLDER = join(__dirname, '..', '..', '..', '..', 'drizzle');

/**
 * Runs the migrations, then closes the pool. Called by a dedicated script (`pnpm db:migrate`),
 * by CI and by a compose step — NEVER at API startup.
 */
export async function runMigrations(env: Pick<Env, 'DATABASE_URL'>): Promise<void> {
  const { db, pool } = createMigrationConnection(env);
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations(migrationEnvSchema.parse(process.env)).then(
    () => {
      process.stdout.write(`${JSON.stringify({ level: 'info', msg: 'migrations applied' })}\n`);
      process.exit(0);
    },
    (error: unknown) => {
      process.stderr.write(
        `${JSON.stringify({
          level: 'error',
          msg: 'migrations failed',
          reason: error instanceof Error ? error.message : 'unknown error',
        })}\n`,
      );
      process.exit(1);
    },
  );
}
