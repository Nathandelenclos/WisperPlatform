import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Délégation des routes d'authentification au fournisseur d'identité. La requête est transmise
 * brute : le fournisseur lit lui-même le corps.
 *
 * Ce n'est pas une intention applicative mais un montage de transport, d'où sa place dans la
 * couche interface : elle a le droit de connaître HTTP. Le module d'authentification, seule
 * racine de composition, y branche l'adaptateur.
 */
export interface AuthRequestHandler {
  handle(request: IncomingMessage, response: ServerResponse): Promise<void>;
}
export const AUTH_REQUEST_HANDLER = Symbol('AuthRequestHandler');
