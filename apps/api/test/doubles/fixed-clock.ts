import type { Clock } from '../../src/transcription/application/ports/clock';

/** Clock the test advances by hand: leases become deterministic. */
export class FixedClock implements Clock {
  private current: Date;

  constructor(current: Date) {
    this.current = new Date(current);
  }

  now(): Date {
    return new Date(this.current);
  }

  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1_000);
  }

  set(current: Date): void {
    this.current = new Date(current);
  }
}
