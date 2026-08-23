import { describe, expect, it } from 'vitest';

import { InvalidEnvironmentError, loadEnv } from './env';

/** Le minimum sans lequel la plateforme n'a pas le droit de démarrer. */
const required = {
  DATABASE_URL: 'postgres://wisper@localhost:5432/wisper',
  WEB_ORIGIN: 'http://localhost:5173',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  MEDIA_TOKEN_SECRET: 'b'.repeat(32),
  WORKER_SHARED_TOKEN: 'c'.repeat(32),
};

describe('loadEnv — connexion Google', () => {
  it('traite une option laissée vide comme absente', () => {
    // `.env.example` livre ces lignes vides pour qu'on sache qu'elles existent : copier
    // l'exemple tel quel ne doit pas empêcher l'API de démarrer.
    const env = loadEnv({ ...required, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '  ' });

    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.GOOGLE_CLIENT_SECRET).toBeUndefined();
  });

  it('retient les deux identifiants quand ils sont posés', () => {
    const env = loadEnv({
      ...required,
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_CLIENT_SECRET: 'client-secret',
    });

    expect(env.GOOGLE_CLIENT_ID).toBe('client-id');
    expect(env.GOOGLE_CLIENT_SECRET).toBe('client-secret');
  });

  it('refuse de démarrer sur une configuration à moitié faite', () => {
    // Mieux vaut un refus au démarrage qu'un bouton « Continuer avec Google » qui échoue
    // au clic, chez quelqu'un qui croyait l'avoir configuré.
    expect(() => loadEnv({ ...required, GOOGLE_CLIENT_ID: 'client-id' })).toThrow(
      InvalidEnvironmentError,
    );
    expect(() => loadEnv({ ...required, GOOGLE_CLIENT_SECRET: 'client-secret' })).toThrow(
      InvalidEnvironmentError,
    );
  });

  it('ne laisse jamais fuir une valeur dans le message de refus', () => {
    try {
      loadEnv({ ...required, GOOGLE_CLIENT_ID: 'secret-a-ne-pas-journaliser' });
      expect.unreachable('la configuration à moitié faite doit être refusée');
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('secret-a-ne-pas-journaliser');
      expect(String((error as Error).message)).toContain('GOOGLE_CLIENT_ID');
    }
  });
});
