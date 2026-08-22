import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    // Les tests d'intégration montent un conteneur Postgres jetable : laisser du temps au pull.
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
