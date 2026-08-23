/**
 * Errors of the `transcription` domain.
 *
 * Every invariant violation carries a stable `code`: that is the only contract exposed to the
 * outer layers (the HTTP mapping turns any `DomainError` into a 422).
 */
export class DomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}

/** An invalid time range (non-integer or negative bounds, or a start after the end). */
export class InvalidTimeRangeError extends DomainError {
  constructor(message: string) {
    super('INVALID_TIME_RANGE', message);
  }
}

/** A segment's text is empty once stripped of its whitespace. */
export class InvalidSegmentTextError extends DomainError {
  constructor(message: string) {
    super('INVALID_SEGMENT_TEXT', message);
  }
}

/** The requested model is not one of the known whisper models. */
export class UnsupportedModelError extends DomainError {
  constructor(message: string) {
    super('UNSUPPORTED_MODEL', message);
  }
}

/** The requested placement is not a place where the platform knows how to compute. */
export class UnsupportedPlacementError extends DomainError {
  constructor(message: string) {
    super('UNSUPPORTED_PLACEMENT', message);
  }
}

/** The requested language does not match the expected shape (trust boundary). */
export class InvalidLanguageError extends DomainError {
  constructor(message: string) {
    super('INVALID_LANGUAGE', message);
  }
}

/** The described media is unusable (absurd key, type or size). */
export class InvalidMediaError extends DomainError {
  constructor(message: string) {
    super('INVALID_MEDIA', message);
  }
}

/** The requested transition is illegal from the current status. */
export class IllegalTranscriptionStateError extends DomainError {
  constructor(message: string) {
    super('ILLEGAL_TRANSCRIPTION_STATE', message);
  }
}

/** The run that speaks is no longer the current run — its attempt has been replaced. */
export class StaleRunError extends DomainError {
  constructor(message: string) {
    super('STALE_RUN', message);
  }
}

/** A batch of segments arrived out of order — the previous batch is missing. */
export class OutOfOrderBatchError extends DomainError {
  constructor(message: string) {
    super('OUT_OF_ORDER_BATCH', message);
  }
}

/** The segments of a batch overlap or go backwards in time. */
export class OverlappingSegmentsError extends DomainError {
  constructor(message: string) {
    super('OVERLAPPING_SEGMENTS', message);
  }
}

/** No segment carries the requested ordinal. */
export class SegmentNotFoundError extends DomainError {
  constructor(message: string) {
    super('SEGMENT_NOT_FOUND', message);
  }
}

/** Only the text of a completed transcription can be corrected. */
export class TranscriptionNotCorrectableError extends DomainError {
  constructor(message: string) {
    super('TRANSCRIPTION_NOT_CORRECTABLE', message);
  }
}

/** A lease lasts a positive number of seconds — nothing else is a window of work. */
export class InvalidLeaseDurationError extends DomainError {
  constructor(message: string) {
    super('INVALID_LEASE_DURATION', message);
  }
}

/** A speaker index is a non-negative integer — that is what the clustering produces. */
export class InvalidSpeakerError extends DomainError {
  constructor(message: string) {
    super('INVALID_SPEAKER', message);
  }
}

/** The name given to a speaker breaks its invariants (empty, too long, multiline). */
export class InvalidSpeakerNameError extends DomainError {
  constructor(message: string) {
    super('INVALID_SPEAKER_NAME', message);
  }
}

/** No discovered speaker carries the requested index. */
export class SpeakerNotFoundError extends DomainError {
  constructor(message: string) {
    super('SPEAKER_NOT_FOUND', message);
  }
}
