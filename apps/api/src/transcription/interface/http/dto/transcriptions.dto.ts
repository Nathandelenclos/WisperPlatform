import { z } from 'zod';

import type { SubtitleFormat } from '../../../domain/subtitle-document';

/**
 * Schemas of the user-facing HTTP boundary. They validate only what belongs to the transport
 * (presence, type, route enumeration). The model, the language, a segment's text or the
 * existence of an ordinal are domain invariants: they stay validated by the aggregate, which
 * answers 422, and are not duplicated here.
 */

export const transcriptionIdSchema = z.uuid();

/**
 * `placement` stays a string here: it is a domain enumeration, like the model and the
 * language. The aggregate validates it and answers 422 — the boundary does not duplicate the
 * list.
 */
export const requestTranscriptionBodySchema = z.object({
  model: z.string(),
  language: z.string(),
  placement: z.string().optional(),
});

export const changePlacementBodySchema = z.object({
  placement: z.string(),
});

export const correctSegmentParamsSchema = z.object({
  id: z.uuid(),
  ordinal: z.coerce.number().int(),
});

export const correctSegmentBodySchema = z.object({
  text: z.string(),
});

export const renameSpeakerParamsSchema = z.object({
  id: z.uuid(),
  index: z.coerce.number().int(),
});

export const renameSpeakerBodySchema = z.object({
  name: z.string(),
});

const SUBTITLE_FORMATS = ['srt', 'vtt', 'txt'] as const satisfies readonly SubtitleFormat[];

export const exportQuerySchema = z.object({
  format: z.enum(SUBTITLE_FORMATS),
});

/**
 * The part actually consumed of the multipart file multer writes to disk.
 * Deliberately structural: the interface layer needs nothing else.
 */
export type UploadedMediaFile = {
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
  readonly path: string;
};
