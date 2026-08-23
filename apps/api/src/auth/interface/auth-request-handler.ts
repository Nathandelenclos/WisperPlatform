import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Delegation of the authentication routes to the identity provider. The request is passed raw:
 * the provider reads the body itself.
 *
 * This is not an application intent but transport plumbing, hence its place in the interface
 * layer: that layer is allowed to know HTTP. The authentication module, the only composition
 * root, wires the adapter in here.
 */
export interface AuthRequestHandler {
  handle(request: IncomingMessage, response: ServerResponse): Promise<void>;
}
export const AUTH_REQUEST_HANDLER = Symbol('AuthRequestHandler');
