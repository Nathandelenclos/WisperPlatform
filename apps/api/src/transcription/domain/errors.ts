/**
 * Erreurs du domaine `transcription`.
 *
 * Chaque violation d'invariant porte un `code` stable : c'est le seul contrat exposé aux
 * couches externes (le mapping HTTP traduit toute `DomainError` en 422).
 */
export class DomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}

/** Un intervalle de temps invalide (bornes non entières, négatives ou début après la fin). */
export class InvalidTimeRangeError extends DomainError {
  constructor(message: string) {
    super('INVALID_TIME_RANGE', message);
  }
}

/** Le texte d'un segment est vide une fois débarrassé de ses espaces. */
export class InvalidSegmentTextError extends DomainError {
  constructor(message: string) {
    super('INVALID_SEGMENT_TEXT', message);
  }
}

/** Le modèle demandé ne fait pas partie des modèles whisper connus. */
export class UnsupportedModelError extends DomainError {
  constructor(message: string) {
    super('UNSUPPORTED_MODEL', message);
  }
}

/** La langue demandée ne respecte pas la forme attendue (frontière de confiance). */
export class InvalidLanguageError extends DomainError {
  constructor(message: string) {
    super('INVALID_LANGUAGE', message);
  }
}

/** Le média décrit est inexploitable (clé, type ou taille absurde). */
export class InvalidMediaError extends DomainError {
  constructor(message: string) {
    super('INVALID_MEDIA', message);
  }
}

/** La transition demandée est illégale depuis le statut courant. */
export class IllegalTranscriptionStateError extends DomainError {
  constructor(message: string) {
    super('ILLEGAL_TRANSCRIPTION_STATE', message);
  }
}

/** Le run qui parle n'est plus le run courant : sa tentative a été remplacée. */
export class StaleRunError extends DomainError {
  constructor(message: string) {
    super('STALE_RUN', message);
  }
}

/** Un lot de segments est arrivé hors séquence : il manque le lot précédent. */
export class OutOfOrderBatchError extends DomainError {
  constructor(message: string) {
    super('OUT_OF_ORDER_BATCH', message);
  }
}

/** Les segments d'un lot se chevauchent ou reviennent en arrière dans le temps. */
export class OverlappingSegmentsError extends DomainError {
  constructor(message: string) {
    super('OVERLAPPING_SEGMENTS', message);
  }
}

/** Aucun segment ne porte l'ordinal demandé. */
export class SegmentNotFoundError extends DomainError {
  constructor(message: string) {
    super('SEGMENT_NOT_FOUND', message);
  }
}

/** On ne corrige que le texte d'une transcription achevée. */
export class TranscriptionNotCorrectableError extends DomainError {
  constructor(message: string) {
    super('TRANSCRIPTION_NOT_CORRECTABLE', message);
  }
}
