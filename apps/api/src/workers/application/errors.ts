/**
 * Erreurs de la couche applicative du contexte `workers` : elles ne traduisent pas une
 * violation d'invariant métier mais un refus d'accès. Leur `code` est stable, le mapping HTTP
 * s'appuie dessus.
 */
export class WorkerApplicationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}

/**
 * Clé de machine inconnue — ou appartenant à quelqu'un d'autre : on ne révèle jamais
 * l'existence de la clé d'autrui. Mappée en 404.
 */
export class WorkerKeyNotFoundError extends WorkerApplicationError {
  constructor(message = 'clé de machine introuvable') {
    super('WORKER_KEY_NOT_FOUND', message);
  }
}
