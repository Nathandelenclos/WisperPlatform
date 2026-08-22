import { InvalidSpeakerError } from './errors';
import { TimeRange } from './time-range';

/**
 * Un tour de parole tel que la diarisation le livre : un intervalle de temps et l'indice
 * technique du locuteur qui parle pendant cet intervalle. Value object immuable.
 *
 * Un tour n'est pas persisté : c'est une entrée de la passe d'attribution, dont seul le
 * résultat — le locuteur porté par chaque segment — appartient à l'aggregate.
 */
export class SpeakerTurn {
  private constructor(
    readonly range: TimeRange,
    readonly speaker: number,
  ) {
    Object.freeze(this);
  }

  static of(range: TimeRange, speaker: number): SpeakerTurn {
    if (!Number.isInteger(speaker) || speaker < 0) {
      throw new InvalidSpeakerError(
        `l'indice d'un locuteur est un entier positif ou nul, reçu ${speaker}`,
      );
    }
    return new SpeakerTurn(range, speaker);
  }
}

/**
 * Locuteur d'un intervalle : celui dont les tours recouvrent la plus grande part de sa durée.
 * Les tours d'un même locuteur s'additionnent — un segment coupé en deux par une interjection
 * revient à celui qui a le plus parlé, pas au dernier arrivé.
 *
 * Deux propriétés voulues : l'ordre des tours en entrée n'a aucune incidence, et une même
 * diarisation rend toujours la même attribution. D'où le départage à égalité de recouvrement
 * par le plus petit indice — arbitraire, mais fixé. Aucun recouvrement : pas de locuteur.
 */
export function dominantSpeaker(turns: readonly SpeakerTurn[], range: TimeRange): number | null {
  const overlapBySpeaker = new Map<number, number>();
  for (const turn of turns) {
    const overlapMs = turn.range.overlapMsWith(range);
    if (overlapMs === 0) continue;
    overlapBySpeaker.set(turn.speaker, (overlapBySpeaker.get(turn.speaker) ?? 0) + overlapMs);
  }

  let dominant: number | null = null;
  let dominantOverlapMs = 0;
  for (const [speaker, overlapMs] of overlapBySpeaker) {
    const wins =
      dominant === null ||
      overlapMs > dominantOverlapMs ||
      (overlapMs === dominantOverlapMs && speaker < dominant);
    if (wins) {
      dominant = speaker;
      dominantOverlapMs = overlapMs;
    }
  }
  return dominant;
}

/** Les locuteurs que la diarisation a découverts, indices distincts triés par ordre croissant. */
export function distinctSpeakers(turns: readonly SpeakerTurn[]): number[] {
  return [...new Set(turns.map((turn) => turn.speaker))].sort((a, b) => a - b);
}
