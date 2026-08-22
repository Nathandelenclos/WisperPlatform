/** Source de temps : injectée pour que les bails et les échéances soient testables. */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('Clock');
