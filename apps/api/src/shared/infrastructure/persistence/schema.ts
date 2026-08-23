import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Tables de better-auth. Les NOMS DE PROPRIÉTÉS (camelCase) sont un contrat :
 * `better-auth/adapters/drizzle` résout ses champs par `schema[model][fieldName]`,
 * où `fieldName` est le nom camelCase du champ better-auth. Les noms de colonnes SQL
 * restent en snake_case, ce qui est la convention par défaut de l'adaptateur.
 * Vérifié dans `@better-auth/core@1.7.1/dist/db/get-tables.mjs`.
 */
export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [unique('user_email_unique').on(table.email)],
);

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    unique('session_token_unique').on(table.token),
    index('session_user_id_idx').on(table.userId),
  ],
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    // `issuer` est exigé depuis better-auth 1.7 et participe à l'unicité du compte externe.
    issuer: text('issuer').notNull(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('account_issuer_account_id_unique').on(table.issuer, table.accountId),
    index('account_user_id_idx').on(table.userId),
  ],
);

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
);

/**
 * Aggregate `Transcription`. `reserved_at` / `reserved_by` sont des colonnes purement
 * techniques de file d'attente : l'aggregate ne les connaît pas et ne les écrit jamais.
 */
export const transcriptions = pgTable(
  'transcriptions',
  {
    id: uuid('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    /**
     * Où la transcription doit être calculée : `service` (les workers de la plateforme) ou
     * `owner` (les machines de son propriétaire). Défaut `service`, pour que toute demande
     * écrite avant cette colonne reste calculée là où elle l'était.
     */
    placement: text('placement').notNull().default('service'),
    model: text('model').notNull(),
    language: text('language').notNull(),
    mediaStorageKey: text('media_storage_key').notNull(),
    mediaOriginalName: text('media_original_name').notNull(),
    mediaContentType: text('media_content_type').notNull(),
    // `mode: 'number'` : sûr jusqu'à Number.MAX_SAFE_INTEGER (9 007 199 254 740 991 octets,
    // soit ~8 PiO). La borne d'acceptation d'un média est MEDIA_MAX_BYTES (2 GiO par défaut),
    // six ordres de grandeur en dessous : aucune perte de précision possible.
    mediaByteSize: bigint('media_byte_size', { mode: 'number' }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    currentRunId: uuid('current_run_id'),
    claimedBy: text('claimed_by'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    lastAppliedBatchSequence: integer('last_applied_batch_sequence').notNull().default(0),
    failureReason: text('failure_reason'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    reservedAt: timestamp('reserved_at', { withTimezone: true }),
    reservedBy: text('reserved_by'),
    /**
     * Verrou optimiste. Toute écriture d'un aggregate chargé exige la version lue et la
     * remplace : deux écrivains partis du même état ne peuvent pas s'écraser en silence.
     */
    version: integer('version').notNull().default(1),
  },
  (table) => [
    index('transcriptions_status_requested_at_idx').on(table.status, table.requestedAt),
    index('transcriptions_owner_id_requested_at_idx').on(table.ownerId, table.requestedAt.desc()),
    index('transcriptions_status_lease_expires_at_idx').on(table.status, table.leaseExpiresAt),
  ],
);

export const transcriptionSegments = pgTable(
  'transcription_segments',
  {
    transcriptionId: uuid('transcription_id')
      .notNull()
      .references(() => transcriptions.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    startMs: integer('start_ms').notNull(),
    endMs: integer('end_ms').notNull(),
    text: text('text').notNull(),
    corrected: boolean('corrected').notNull().default(false),
    /** Locuteur attribué par la diarisation ; `null` quand elle n'a pas eu lieu. */
    speakerIndex: integer('speaker_index'),
  },
  (table) => [
    primaryKey({
      name: 'transcription_segments_pkey',
      columns: [table.transcriptionId, table.ordinal],
    }),
  ],
);

/**
 * Locuteurs d'une transcription. L'indice vient du clustering de la diarisation, le nom du
 * propriétaire — d'où sa nullité : un locuteur existe avant d'avoir un nom.
 */
export const transcriptionSpeakers = pgTable(
  'transcription_speakers',
  {
    transcriptionId: uuid('transcription_id')
      .notNull()
      .references(() => transcriptions.id, { onDelete: 'cascade' }),
    index: integer('index').notNull(),
    name: text('name'),
  },
  (table) => [
    primaryKey({
      name: 'transcription_speakers_pkey',
      columns: [table.transcriptionId, table.index],
    }),
  ],
);

/**
 * Clés de machine : le secret qu'un utilisateur colle dans la commande de lancement de son
 * worker. Seule l'empreinte est stockée, jamais le secret. La révocation est une date, pas une
 * suppression : la trace d'une machine reste lisible après un incident.
 */
export const workerKeys = pgTable(
  'worker_keys',
  {
    id: uuid('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    secretFingerprint: text('secret_fingerprint').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    // L'empreinte est le chemin d'authentification : l'unicité en fait une clé de recherche
    // sûre, et interdit qu'un même secret ouvre deux comptes.
    unique('worker_keys_secret_fingerprint_unique').on(table.secretFingerprint),
    index('worker_keys_owner_id_created_at_idx').on(table.ownerId, table.createdAt.desc()),
  ],
);
