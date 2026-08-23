/** Source de temps : injectée pour que les instants de création et de passage soient testables. */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('WorkersClock');
