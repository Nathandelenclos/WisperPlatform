import type { IncomingMessage } from 'node:http';

/** Préfixe des routes du fournisseur d'identité, corps compris. */
const AUTH_BASE_PATH = '/api/auth';

/**
 * Décide si le corps d'une requête doit être analysé en JSON par l'application.
 *
 * Les routes d'authentification sont exclues : better-auth lit lui-même le flux de la requête,
 * et un analyseur en amont le consommerait avant lui. Pour toutes les autres, on reproduit la
 * sélection par type de média que fait body-parser lorsqu'on ne lui impose pas de prédicat.
 */
export function shouldParseJsonBody(request: IncomingMessage): boolean {
  const path = (request.url ?? '').split('?', 1)[0];
  if (path === AUTH_BASE_PATH || path.startsWith(`${AUTH_BASE_PATH}/`)) {
    return false;
  }
  const mediaType = (request.headers['content-type'] ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  return mediaType === 'application/json' || mediaType.endsWith('+json');
}
