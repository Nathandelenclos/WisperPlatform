import type { IdGenerator } from '../../src/transcription/application/ports/id-generator';

/**
 * Identifiers that are predictable AND valid as uuid v4: the same contract suite runs on the
 * doubles and on Postgres, where the columns are typed `uuid`.
 */
export class SequentialIdGenerator implements IdGenerator {
  private issued = 0;

  constructor(private readonly prefix = '00000000') {}

  next(): string {
    this.issued += 1;
    return `${this.prefix}-0000-4000-8000-${String(this.issued).padStart(12, '0')}`;
  }
}
