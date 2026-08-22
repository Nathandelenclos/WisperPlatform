import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * Identifiant de corrélation de la requête en cours. Il est porté par un contexte asynchrone
 * plutôt que passé de main en main : sans lui, une ligne applicative — un refus d'accès média,
 * par exemple — ne peut pas être rattachée à la requête qui l'a provoquée, ce qui est
 * précisément le diagnostic que ces logs existent pour permettre.
 */
export const correlationStorage = new AsyncLocalStorage<string>();

/** Un en-tête reçu ne devient un identifiant que s'il est court et sans surprise. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Reprend l'identifiant fourni par l'appelant quand il est inoffensif, sinon en génère un.
 * `existing` permet de rester aligné sur un identifiant déjà attribué en amont.
 */
export function resolveCorrelationId(candidate: unknown, existing?: unknown): string {
  for (const value of [existing, candidate]) {
    if (typeof value === 'string' && SAFE_REQUEST_ID.test(value)) {
      return value;
    }
  }
  return randomUUID();
}

export const CORRELATION_ID_HEADER = 'x-request-id';
