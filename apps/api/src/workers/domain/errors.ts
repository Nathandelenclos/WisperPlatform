/**
 * Errors of the `workers` domain.
 *
 * A base class owned by this context: the dependency rule forbids a domain from importing that
 * of another bounded context, and there is no shared kernel. Every invariant violation carries
 * a stable `code`, the only contract exposed to the outer layers (the HTTP mapping turns any
 * domain error into a 422).
 */
export class WorkerDomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}

/** A machine label breaks its invariants (empty, too long, multiline). */
export class InvalidWorkerKeyLabelError extends WorkerDomainError {
  constructor(message: string) {
    super('INVALID_WORKER_KEY_LABEL', message);
  }
}
