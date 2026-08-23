/**
 * Erreurs du domaine `workers`.
 *
 * Base propre au contexte : la règle de dépendance interdit à un domaine d'importer celui d'un
 * autre contexte borné, et il n'existe pas de noyau partagé. Chaque violation d'invariant porte
 * un `code` stable, seul contrat exposé aux couches externes (le mapping HTTP traduit toute
 * erreur de domaine en 422).
 */
export class WorkerDomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}

/** Le libellé d'une machine ne respecte pas ses invariants (vide, trop long, multiligne). */
export class InvalidWorkerKeyLabelError extends WorkerDomainError {
  constructor(message: string) {
    super('INVALID_WORKER_KEY_LABEL', message);
  }
}
