import { z } from 'zod';

/**
 * Minimum length of a secret. 32 characters match the output of `openssl rand -hex 16`;
 * the operations documentation recommends 64 (rand -hex 32).
 */
const MIN_SECRET_LENGTH = 32;

/**
 * A secret never has a default value: a platform that starts with a secret everybody knows
 * is a platform without authentication.
 */
const secret = z
  .string()
  .trim()
  .min(MIN_SECRET_LENGTH, `must be at least ${MIN_SECRET_LENGTH} characters long`);

const positiveInteger = z.coerce.number().int().positive();

/**
 * An option left empty means "not set". `.env.example` ships those lines empty so that one
 * knows they exist — without that equivalence, copying the example as-is would make startup
 * be refused over a value nobody meant to give.
 */
const optional = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .optional();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: positiveInteger.max(65_535).default(3000),
  DATABASE_URL: z.string().trim().min(1),
  WEB_ORIGIN: z.string().trim().min(1),

  BETTER_AUTH_SECRET: secret,
  MEDIA_TOKEN_SECRET: secret,
  WORKER_SHARED_TOKEN: secret,

  /**
   * Google OAuth credentials, optional: without them Google sign-in is simply not offered and
   * the password stays the only way in. The two go together — setting only one is a half-done
   * configuration, hence a refusal at startup rather than a button that fails on click.
   */
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,

  MEDIA_STORE_DIR: z.string().trim().min(1).default('./media-store'),
  MEDIA_MAX_BYTES: positiveInteger.default(2_147_483_648),
  JOB_LEASE_SECONDS: positiveInteger.default(120),
  JOB_MAX_ATTEMPTS: positiveInteger.default(3),
})
  .refine(
    (env) =>
      (env.GOOGLE_CLIENT_ID === undefined) === (env.GOOGLE_CLIENT_SECRET === undefined),
    {
      error: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET go together: set both, or neither',
      path: ['GOOGLE_CLIENT_ID'],
    },
  );

export type Env = z.infer<typeof envSchema>;

/** Canonical injection token for the validated configuration. */
export const ENV = Symbol('Env');

export class InvalidEnvironmentError extends Error {
  readonly code = 'INVALID_ENVIRONMENT';

  constructor(readonly invalidKeys: readonly string[], message: string) {
    super(message);
    this.name = 'InvalidEnvironmentError';
  }
}

/**
 * Validates the environment at startup and fails loudly when it is incomplete.
 * The error message carries ONLY variable names and reasons: never a value, so that a
 * malformed secret does not end up in the logs.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;

  const problems = result.error.issues.map((issue) => {
    const key = issue.path.join('.') || '(root)';
    return `${key}: ${issue.message}`;
  });
  const invalidKeys = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];

  throw new InvalidEnvironmentError(
    invalidKeys,
    `Invalid configuration, the application cannot start:\n  - ${problems.join('\n  - ')}`,
  );
}
