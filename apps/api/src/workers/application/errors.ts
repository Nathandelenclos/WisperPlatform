/**
 * Errors of the application layer of the `workers` context: they do not express a business
 * invariant violation but an access refusal. Their `code` is stable, the HTTP mapping relies
 * on it.
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
 * Unknown machine key — or one belonging to somebody else: the existence of another user's key
 * is never revealed. Mapped to a 404.
 */
export class WorkerKeyNotFoundError extends WorkerApplicationError {
  constructor(message = 'machine key not found') {
    super('WORKER_KEY_NOT_FOUND', message);
  }
}
