/** Time source: injected so that creation and sighting instants are testable. */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('WorkersClock');
