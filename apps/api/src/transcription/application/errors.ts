/**
 * Erreurs de la couche applicative : elles ne traduisent pas une violation d'invariant métier
 * mais un refus d'accès. Leur `code` est stable, le mapping HTTP s'appuie dessus.
 */
export class ApplicationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}

/**
 * Transcription inconnue — ou appartenant à quelqu'un d'autre : on ne révèle jamais
 * l'existence de la ressource d'autrui. Mappée en 404.
 */
export class TranscriptionNotFoundError extends ApplicationError {
  constructor(message = 'transcription introuvable') {
    super('TRANSCRIPTION_NOT_FOUND', message);
  }
}

/** Laissez-passer média invalide, expiré, ou dont le run n'est plus celui en cours. Mappée en 403. */
export class MediaAccessDeniedError extends ApplicationError {
  constructor(message = 'accès au média refusé') {
    super('MEDIA_ACCESS_DENIED', message);
  }
}
