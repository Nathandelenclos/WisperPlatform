/** Time source: injected so that leases and deadlines are testable. */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('Clock');
