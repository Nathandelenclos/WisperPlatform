/**
 * Application-layer errors: they do not express a violated business invariant but a refused
 * access. Their `code` is stable — the HTTP mapping relies on it.
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
 * Unknown transcription — or one belonging to someone else: we never reveal the existence of
 * another user's resource. Mapped to 404.
 */
export class TranscriptionNotFoundError extends ApplicationError {
  constructor(message = 'transcription not found') {
    super('TRANSCRIPTION_NOT_FOUND', message);
  }
}

/** Media pass invalid, expired, or whose run is no longer the current one. Mapped to 403. */
export class MediaAccessDeniedError extends ApplicationError {
  constructor(message = 'media access denied') {
    super('MEDIA_ACCESS_DENIED', message);
  }
}

/**
 * Two writers modified the same transcription from the same state: the second one does not
 * write. This is a persistence-port failure, replayable — the nominal case being a user
 * correction that crosses a batch of segments from the worker. Mapped to 409 if it surfaces.
 */
export class ConcurrentTranscriptionWriteError extends ApplicationError {
  constructor(transcriptionId: string) {
    super('CONCURRENT_WRITE', `transcription ${transcriptionId} modified in the meantime`);
  }
}
