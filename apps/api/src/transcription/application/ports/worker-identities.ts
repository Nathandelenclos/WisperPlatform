/**
 * Ce que la plateforme déduit du jeton porteur d'un worker : pour qui il travaille.
 *
 * - `service` : un worker de la plateforme, qui porte le secret partagé ;
 * - `owner` : une machine déclarée par un utilisateur, qui porte une clé de machine.
 *
 * C'est le seul fait dont la file a besoin. Un worker n'est jamais les deux, et un réclamant
 * ne se voit jamais proposer le travail de l'autre.
 */
export type Claimant = { kind: 'service' } | { kind: 'owner'; ownerId: string };

/**
 * Résolution du jeton porteur présenté par un worker. `null` signifie « jeton inconnu » —
 * mauvais secret partagé, clé inexistante ou clé révoquée, indistinctement : rien ne doit
 * permettre à un porteur de jeton de deviner laquelle des trois.
 */
export interface WorkerIdentities {
  resolve(bearerToken: string): Promise<Claimant | null>;
}

export const WORKER_IDENTITIES = Symbol('WorkerIdentities');
