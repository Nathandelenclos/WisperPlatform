import { z } from 'zod';

import type { SubtitleFormat } from '../../../domain/subtitle-document';

/**
 * Schémas de la frontière HTTP côté utilisateur. Ils ne valident que ce qui relève du
 * transport (présence, type, énumération de route). Le modèle, la langue, le texte d'un
 * segment ou l'existence d'un ordinal sont des invariants du domaine : ils restent validés
 * par l'aggregate, qui répond 422, et ne sont pas dupliqués ici.
 */

export const transcriptionIdSchema = z.uuid();

export const requestTranscriptionBodySchema = z.object({
  model: z.string(),
  language: z.string(),
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
 * Part du fichier multipart écrit sur disque par multer effectivement consommée.
 * Volontairement structurel : la couche interface n'a besoin de rien d'autre.
 */
export type UploadedMediaFile = {
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
  readonly path: string;
};
