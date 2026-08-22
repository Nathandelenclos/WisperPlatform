import { join } from 'node:path';

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { z } from 'zod';

import type { Env } from '../config/env';
import { createMigrationConnection } from './database';

/**
 * Le migrateur ne consomme qu'une chaîne de connexion : il valide donc ce seul réglage.
 * Valider tout l'environnement obligerait son conteneur à détenir les secrets de session et
 * de jeton média, dont une migration SQL n'a aucun usage.
 */
const migrationEnvSchema = z.object({ DATABASE_URL: z.string().trim().min(1) });

/**
 * Dossier des migrations versionnées. Le calcul tombe sur `apps/api/` aussi bien depuis
 * `src/shared/infrastructure/persistence` (tsx) que depuis `dist/shared/infrastructure/persistence`.
 */
export const MIGRATIONS_FOLDER = join(__dirname, '..', '..', '..', '..', 'drizzle');

/**
 * Joue les migrations puis ferme le pool. Appelé par un script dédié (`pnpm db:migrate`),
 * par la CI et par une étape du compose — JAMAIS au démarrage de l'API.
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
