/**
 * Fabrique et empreinte des secrets de machine. Le domaine ne tire pas d'aléa lui-même : la
 * source d'entropie est une préoccupation de plateforme.
 */
export interface WorkerKeySecrets {
  /** Un secret neuf, imprévisible, à montrer une seule fois à son propriétaire. */
  generate(): string;
  /**
   * Empreinte stable du secret, seule forme persistée. Un hachage simple suffit ici, et c'est
   * délibéré : le secret est un aléa de 256 bits, pas un mot de passe. Aucune attaque par
   * dictionnaire n'est possible sur une telle entropie, et un KDF lent transformerait chaque
   * réclamation de travail en calcul coûteux, plusieurs fois par seconde et par machine.
   */
  fingerprint(secret: string): string;
}

export const WORKER_KEY_SECRETS = Symbol('WorkerKeySecrets');
