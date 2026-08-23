import type { IncomingMessage } from 'node:http';

/** Prefix of the identity provider routes, bodies included. */
const AUTH_BASE_PATH = '/api/auth';

/**
 * Decides whether the body of a request must be parsed as JSON by the application.
 *
 * The authentication routes are excluded: better-auth reads the request stream itself, and a
 * parser upstream would consume it before it does. For every other route, this reproduces the
 * media type selection body-parser makes when it is given no predicate.
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
