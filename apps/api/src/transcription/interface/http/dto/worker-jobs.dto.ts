import { z } from 'zod';

/**
 * Schemas of the worker-facing HTTP boundary. A worker is a less trustworthy source than an
 * authenticated browser: every field is bounded in size so that nothing unbounded crosses the
 * boundary. The business invariants (batch order, current run, segment overlap) remain the
 * aggregate's business.
 */

const MAX_SERVED_MODELS = 16;
const MAX_SEGMENTS_PER_BATCH = 1_000;

/**
 * One speaker turn per second of media for more than two hours: past that, it is no longer a
 * diarization. The bound exists so that nothing unbounded crosses the boundary.
 */
const MAX_SPEAKER_TURNS = 10_000;

/**
 * Timestamp ceiling: well beyond any media the platform accepts (24 h), and below the integer
 * precision of a float. Without it, `endMs` was the only field of the worker boundary with no
 * upper bound — which this file's preamble nonetheless promises.
 */
const MAX_TIMESTAMP_MS = 24 * 60 * 60 * 1_000;

/** A speech segment, not a novel pasted into a text field. */
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
