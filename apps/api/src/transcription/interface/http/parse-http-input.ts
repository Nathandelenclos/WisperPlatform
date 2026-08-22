import { BadRequestException } from '@nestjs/common';
import { prettifyError } from 'zod';
import type { ZodType, output } from 'zod';

/**
 * Valide une entrée HTTP (corps, paramètre de route, chaîne de requête) et transforme un
 * échec en 400. Le message décrit la contrainte violée ; rien n'est journalisé ici.
 */
export function parseHttpInput<S extends ZodType>(schema: S, input: unknown): output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException(prettifyError(result.error));
  }
  return result.data;
}
