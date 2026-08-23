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
 * better-auth tables. The PROPERTY NAMES (camelCase) are a contract:
 * `better-auth/adapters/drizzle` resolves its fields through `schema[model][fieldName]`,
 * where `fieldName` is the camelCase name of the better-auth field. The SQL column names
 * stay in snake_case, which is the adapter's default convention.
 * Verified in `@better-auth/core@1.7.1/dist/db/get-tables.mjs`.
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
    // `issuer` is required as of better-auth 1.7 and takes part in the external account's
    // uniqueness.
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
 * `Transcription` aggregate. `reserved_at` / `reserved_by` are purely technical queue
 * columns: the aggregate does not know about them and never writes them.
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
     * Where the transcription is to be computed: `service` (the platform workers) or `owner`
     * (its owner's machines). Defaults to `service`, so that every request written before this
     * column keeps being computed where it already was.
     */
    placement: text('placement').notNull().default('service'),
    model: text('model').notNull(),
    language: text('language').notNull(),
    mediaStorageKey: text('media_storage_key').notNull(),
    mediaOriginalName: text('media_original_name').notNull(),
    mediaContentType: text('media_content_type').notNull(),
    // `mode: 'number'`: safe up to Number.MAX_SAFE_INTEGER (9,007,199,254,740,991 bytes, i.e.
    // ~8 PiB). The acceptance bound for a media file is MEDIA_MAX_BYTES (2 GiB by default),
    // six orders of magnitude below: no loss of precision is possible.
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
     * Optimistic lock. Every write of a loaded aggregate requires the version that was read
     * and replaces it: two writers starting from the same state cannot silently overwrite
     * each other.
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
    /** Speaker assigned by diarization; `null` when diarization did not run. */
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
 * Speakers of a transcription. The index comes from the diarization clustering, the name from
 * the owner — hence its nullability: a speaker exists before it has a name.
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
 * Machine keys: the secret a user pastes into the launch command of their worker. Only the
 * fingerprint is stored, never the secret. Revocation is a date, not a deletion: the trace of a
 * machine stays readable after an incident.
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
    // The fingerprint is the authentication path: uniqueness makes it a safe lookup key, and
    // forbids the same secret from opening two accounts.
    unique('worker_keys_secret_fingerprint_unique').on(table.secretFingerprint),
    index('worker_keys_owner_id_created_at_idx').on(table.ownerId, table.createdAt.desc()),
  ],
);
