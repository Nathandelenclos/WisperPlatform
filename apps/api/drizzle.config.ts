import { defineConfig } from 'drizzle-kit';

/**
 * Configuration of the migration tool (drizzle-kit), not of the application.
 * `drizzle-kit generate` opens no connection: the connection string is only required by the
 * commands that talk to the database.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/shared/infrastructure/persistence/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});
