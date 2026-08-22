import { defineConfig } from 'drizzle-kit';

/**
 * Configuration de l'outil de migration (drizzle-kit), pas de l'application.
 * `drizzle-kit generate` n'ouvre aucune connexion : la chaîne n'est requise que pour
 * les commandes qui parlent à la base.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/shared/infrastructure/persistence/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});
