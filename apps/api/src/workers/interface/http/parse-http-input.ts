import { BadRequestException } from '@nestjs/common';
import { prettifyError } from 'zod';
import type { ZodType, output } from 'zod';

/**
 * Validates an HTTP input (body, route parameter) and turns a failure into a 400. The message
 * describes the violated constraint — nothing is logged here.
 *
 * Twin of the one in the `transcription` context: the HTTP boundary of a bounded context does
 * not depend on another's, and this particular translation is nothing but framework glue.
 */
export function parseHttpInput<S extends ZodType>(schema: S, input: unknown): output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException(prettifyError(result.error));
  }
  return result.data;
}
