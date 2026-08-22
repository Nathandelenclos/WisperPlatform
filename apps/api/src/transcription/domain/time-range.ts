import { InvalidTimeRangeError } from './errors';

/**
 * Intervalle de temps d'un segment, exprimé en millisecondes entières depuis le début du média.
 * Value object immuable : construction validée, aucune mutation possible.
 */
export class TimeRange {
  private constructor(
    readonly startMs: number,
    readonly endMs: number,
  ) {
    Object.freeze(this);
  }

  static fromMilliseconds(startMs: number, endMs: number): TimeRange {
    if (!Number.isInteger(startMs) || !Number.isInteger(endMs)) {
      throw new InvalidTimeRangeError(
        'les bornes d\'un intervalle doivent être des millisecondes entières',
      );
    }
    if (startMs < 0) {
      throw new InvalidTimeRangeError('un intervalle ne peut pas commencer avant le début du média');
    }
    if (startMs >= endMs) {
      throw new InvalidTimeRangeError('un intervalle doit se terminer après son début');
    }
    return new TimeRange(startMs, endMs);
  }

  /** Vrai si cet intervalle se termine avant, ou exactement au début de, l'autre. */
  precedesOrTouches(other: TimeRange): boolean {
    return this.endMs <= other.startMs;
  }

  equals(other: TimeRange): boolean {
    return this.startMs === other.startMs && this.endMs === other.endMs;
  }
}
