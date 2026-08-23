import { z } from 'zod';

/**
 * Schémas de la frontière HTTP côté worker. Un worker est une source moins fiable qu'un
 * navigateur authentifié : chaque champ est borné en taille pour que rien d'illimité ne
 * traverse la frontière. Les invariants métier (ordre des lots, run courant, chevauchement
 * des segments) restent l'affaire de l'aggregate.
 */

const MAX_SERVED_MODELS = 16;
const MAX_SEGMENTS_PER_BATCH = 1_000;

/**
 * Un tour de parole par seconde de média pendant plus de deux heures : au-delà, ce n'est plus
 * une diarisation. La borne existe pour que rien d'illimité ne traverse la frontière.
 */
const MAX_SPEAKER_TURNS = 10_000;

/**
 * Plafond d'horodatage : bien au-delà de tout média que la plateforme accepte (24 h), et en
 * deçà de la précision entière du flottant. Sans lui, `endMs` était le seul champ de la
 * frontière worker sans borne supérieure, ce que le préambule de ce fichier promet pourtant.
 */
const MAX_TIMESTAMP_MS = 24 * 60 * 60 * 1_000;

/** Un segment de parole, pas un roman collé dans un champ de texte. */
const MAX_SEGMENT_TEXT_LENGTH = 10_000;

export const runIdSchema = z.uuid();

export const mediaTokenSchema = z.string().min(1).max(1_024);

export const claimJobBodySchema = z.object({
  workerId: z.string().min(1).max(128),
  models: z.array(z.string().max(64)).min(1).max(MAX_SERVED_MODELS),
});

export const appendSegmentsBodySchema = z.object({
  transcriptionId: z.uuid(),
  batchSequence: z.number().int().min(0),
  segments: z
    .array(
      z.object({
        startMs: z.number().int().min(0).max(MAX_TIMESTAMP_MS),
        endMs: z.number().int().min(0).max(MAX_TIMESTAMP_MS),
        text: z.string().max(MAX_SEGMENT_TEXT_LENGTH),
      }),
    )
    .max(MAX_SEGMENTS_PER_BATCH),
});

export const jobReferenceBodySchema = z.object({
  transcriptionId: z.uuid(),
});

export const failJobBodySchema = z.object({
  transcriptionId: z.uuid(),
  reason: z.string().max(2_000),
});

export const assignSpeakersBodySchema = z.object({
  transcriptionId: z.uuid(),
  turns: z
    .array(
      z.object({
        startMs: z.number().int().min(0).max(MAX_TIMESTAMP_MS),
        endMs: z.number().int().min(0).max(MAX_TIMESTAMP_MS),
        speaker: z.number().int().min(0),
      }),
    )
    .max(MAX_SPEAKER_TURNS),
});
