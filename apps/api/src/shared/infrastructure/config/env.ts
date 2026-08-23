import { z } from 'zod';

/**
 * Longueur minimale d'un secret. 32 caractères correspondent à la sortie de
 * `openssl rand -hex 16` ; la documentation d'exploitation recommande 64 (rand -hex 32).
 */
const MIN_SECRET_LENGTH = 32;

/**
 * Un secret n'a jamais de valeur par défaut : une plateforme qui démarre avec un secret
 * connu de tous est une plateforme sans authentification.
 */
const secret = z
  .string()
  .trim()
  .min(MIN_SECRET_LENGTH, `doit compter au moins ${MIN_SECRET_LENGTH} caractères`);

const positiveInteger = z.coerce.number().int().positive();

/**
 * Une option laissée vide vaut « pas posée ». `.env.example` livre ces lignes vides pour
 * qu'on sache qu'elles existent ; sans cette équivalence, copier l'exemple tel quel ferait
 * refuser le démarrage sur une valeur que personne n'a voulu donner.
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
   * Identifiants OAuth Google, optionnels : sans eux, la connexion Google n'est simplement
   * pas proposée et le mot de passe reste la seule voie. Les deux vont ensemble — n'en poser
   * qu'un est une configuration à moitié faite, donc un refus au démarrage plutôt qu'un
   * bouton qui échoue au clic.
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
      error:
        'GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET vont ensemble : posez les deux, ou aucun',
      path: ['GOOGLE_CLIENT_ID'],
    },
  );

export type Env = z.infer<typeof envSchema>;

/** Jeton d'injection canonique de la configuration validée. */
export const ENV = Symbol('Env');

export class InvalidEnvironmentError extends Error {
  readonly code = 'INVALID_ENVIRONMENT';

  constructor(readonly invalidKeys: readonly string[], message: string) {
    super(message);
    this.name = 'InvalidEnvironmentError';
  }
}

/**
 * Valide l'environnement au démarrage et échoue bruyamment s'il est incomplet.
 * Le message d'erreur ne contient QUE des noms de variables et des raisons :
 * jamais une valeur, pour qu'un secret mal formé ne finisse pas dans les logs.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;

  const problems = result.error.issues.map((issue) => {
    const key = issue.path.join('.') || '(racine)';
    return `${key} : ${issue.message}`;
  });
  const invalidKeys = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];

  throw new InvalidEnvironmentError(
    invalidKeys,
    `Configuration invalide, l'application ne peut pas démarrer :\n  - ${problems.join('\n  - ')}`,
  );
}
