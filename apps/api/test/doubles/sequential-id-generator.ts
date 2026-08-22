import type { IdGenerator } from '../../src/transcription/application/ports/id-generator';

/**
 * Identifiants prévisibles ET valides comme uuid v4 : la même suite de contrat tourne sur les
 * doubles et sur Postgres, où les colonnes sont typées `uuid`.
 */
export class SequentialIdGenerator implements IdGenerator {
  private issued = 0;

  constructor(private readonly prefix = '00000000') {}

  next(): string {
    this.issued += 1;
    return `${this.prefix}-0000-4000-8000-${String(this.issued).padStart(12, '0')}`;
  }
}
