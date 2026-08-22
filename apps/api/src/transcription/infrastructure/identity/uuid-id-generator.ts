import { randomUUID } from 'node:crypto';

import type { IdGenerator } from '../../application/ports/id-generator';

export class UuidIdGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}
