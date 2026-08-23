import { BadRequestException } from '@nestjs/common';
import { prettifyError } from 'zod';
import type { ZodType, output } from 'zod';

/**
 * Valide une entrée HTTP (corps, paramètre de route) et transforme un échec en 400. Le message
 * décrit la contrainte violée ; rien n'est journalisé ici.
 *
 * Jumeau de celui du contexte `transcription` : la frontière HTTP d'un contexte borné ne
 * dépend pas de celle d'un autre, et cette traduction-là n'est que de la colle de framework.
 */
export function parseHttpInput<S extends ZodType>(schema: S, input: unknown): output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException(prettifyError(result.error));
  }
  return result.data;
}
