import { z } from 'zod';

/**
 * Schemas of the machine keys HTTP boundary. They validate only what belongs to transport
 * (presence, type, shape of a route identifier). The label invariants belong to the domain: it
 * validates them and answers 422, they are not duplicated here.
 *
 * The label is still bounded in raw length: this is a trust boundary, and nothing justifies
 * copying a megabyte of text before refusing it.
 */

export const workerKeyIdSchema = z.uuid();

/** Transport bound, far above the business bound (60 characters). */
const MAX_RAW_LABEL_LENGTH = 1_000;

export const registerWorkerKeyBodySchema = z.object({
  label: z.string().max(MAX_RAW_LABEL_LENGTH),
});
