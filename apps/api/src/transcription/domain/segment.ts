import { InvalidSegmentTextError } from './errors';
import { TimeRange } from './time-range';

/** Forme sérialisable d'un segment, telle que persistée et telle qu'exposée dans les vues. */
export type SegmentState = {
  ordinal: number;
  startMs: number;
  endMs: number;
  text: string;
  corrected: boolean;
  /** Locuteur attribué par la passe de diarisation ; `null` tant qu'elle n'a pas eu lieu. */
  speakerIndex: number | null;
};

/**
 * Un segment de transcription : un intervalle de temps et le texte prononcé.
 * Value object immuable ; une correction produit une nouvelle instance.
 */
export class Segment {
  private constructor(
    readonly ordinal: number,
    readonly range: TimeRange,
    readonly text: string,
    readonly corrected: boolean,
    readonly speakerIndex: number | null,
  ) {
    Object.freeze(this);
  }

  /**
   * Segment tel que produit par le moteur de transcription : jamais corrigé à la naissance,
   * et sans locuteur — la diarisation est une passe distincte, qui peut ne jamais venir.
   */
  static transcribed(ordinal: number, range: TimeRange, text: string): Segment {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      throw new InvalidSegmentTextError('le texte d\'un segment ne peut pas être vide');
    }
    return new Segment(ordinal, range, trimmed, false, null);
  }

  /** Relecture fidèle depuis le stockage : aucune normalisation, l'état revient tel quel. */
  static restore(state: SegmentState): Segment {
    return new Segment(
      state.ordinal,
      TimeRange.fromMilliseconds(state.startMs, state.endMs),
      state.text,
      state.corrected,
      state.speakerIndex,
    );
  }

  withCorrectedText(text: string): Segment {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      throw new InvalidSegmentTextError('une correction ne peut pas vider le texte d\'un segment');
    }
    return new Segment(this.ordinal, this.range, trimmed, true, this.speakerIndex);
  }

  /** Attribution de la passe de diarisation ; `null` quand aucun tour ne recouvre le segment. */
  withSpeaker(speakerIndex: number | null): Segment {
    return new Segment(this.ordinal, this.range, this.text, this.corrected, speakerIndex);
  }

  state(): SegmentState {
    return {
      ordinal: this.ordinal,
      startMs: this.range.startMs,
      endMs: this.range.endMs,
      text: this.text,
      corrected: this.corrected,
      speakerIndex: this.speakerIndex,
    };
  }
}
