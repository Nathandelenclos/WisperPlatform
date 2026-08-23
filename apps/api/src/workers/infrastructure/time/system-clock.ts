import type { Clock } from '../../application/ports/clock';

/**
 * System clock. Owned by this context, like its port: that is what keeps the `workers` context
 * independent from `transcription` at compile time as at run time.
 */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
