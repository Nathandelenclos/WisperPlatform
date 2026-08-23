import { describe, expect, it } from 'vitest';

import { InvalidEnvironmentError, loadEnv } from './env';

/** The bare minimum without which the platform is not allowed to start. */
const required = {
  DATABASE_URL: 'postgres://wisper@localhost:5432/wisper',
  WEB_ORIGIN: 'http://localhost:5173',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  MEDIA_TOKEN_SECRET: 'b'.repeat(32),
  WORKER_SHARED_TOKEN: 'c'.repeat(32),
};

describe('loadEnv — Google sign-in', () => {
  it('treats an option left empty as absent', () => {
    // `.env.example` ships those lines empty so that one knows they exist: copying the
    // example as-is must not stop the API from starting.
    const env = loadEnv({ ...required, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '  ' });

    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.GOOGLE_CLIENT_SECRET).toBeUndefined();
  });

  it('keeps both credentials when they are set', () => {
    const env = loadEnv({
      ...required,
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_CLIENT_SECRET: 'client-secret',
    });

    expect(env.GOOGLE_CLIENT_ID).toBe('client-id');
    expect(env.GOOGLE_CLIENT_SECRET).toBe('client-secret');
  });

  it('refuses to start on a half-done configuration', () => {
    // A refusal at startup beats a "Continue with Google" button that fails on click, for
    // someone who believed they had configured it.
    expect(() => loadEnv({ ...required, GOOGLE_CLIENT_ID: 'client-id' })).toThrow(
      InvalidEnvironmentError,
    );
    expect(() => loadEnv({ ...required, GOOGLE_CLIENT_SECRET: 'client-secret' })).toThrow(
      InvalidEnvironmentError,
    );
  });

  it('never leaks a value into the refusal message', () => {
    try {
      loadEnv({ ...required, GOOGLE_CLIENT_ID: 'secret-that-must-not-be-logged' });
      expect.unreachable('the half-done configuration must be refused');
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('secret-that-must-not-be-logged');
      expect(String((error as Error).message)).toContain('GOOGLE_CLIENT_ID');
    }
  });
});
