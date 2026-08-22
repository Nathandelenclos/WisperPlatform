import { InvalidSpeakerError, InvalidSpeakerNameError } from './errors';

/** Forme sérialisable d'un locuteur, telle que persistée et telle qu'exposée dans les vues. */
export type SpeakerState = {
  index: number;
  name: string | null;
};

/** Au-delà, ce n'est plus un nom : c'est une note collée dans un champ de nom. */
const MAX_NAME_LENGTH = 60;

/**
 * Nom donné par le propriétaire à un locuteur. Value object immuable : il finit dans un
 * fichier de sous-titres, où une ligne est une unité de sens — d'où le refus du multiligne.
 */
export class SpeakerName {
  private constructor(readonly value: string) {
    Object.freeze(this);
  }

  static of(raw: string): SpeakerName {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidSpeakerNameError('le nom d\'un locuteur ne peut pas être vide');
    }
    if (trimmed.length > MAX_NAME_LENGTH) {
      throw new InvalidSpeakerNameError(
        `le nom d'un locuteur ne dépasse pas ${MAX_NAME_LENGTH} caractères`,
      );
    }
    if (/[\r\n]/.test(trimmed)) {
      throw new InvalidSpeakerNameError('le nom d\'un locuteur tient sur une seule ligne');
    }
    return new SpeakerName(trimmed);
  }

  /**
   * Relecture fidèle depuis le stockage : aucune revalidation. Un nom écrit sous une règle
   * plus large ne doit pas rendre son aggregate irrécupérable.
   */
  static restored(value: string): SpeakerName {
    return new SpeakerName(value);
  }
}

/**
 * Un locuteur d'une transcription : l'indice technique produit par le clustering de la
 * diarisation, et le nom que le propriétaire lui a éventuellement donné.
 * Value object immuable ; renommer produit une nouvelle instance.
 */
export class Speaker {
  private constructor(
    readonly index: number,
    readonly name: SpeakerName | null,
  ) {
    Object.freeze(this);
  }

  /** Locuteur tel que la diarisation le livre : un indice, pas encore de nom. */
  static discovered(index: number): Speaker {
    if (!Number.isInteger(index) || index < 0) {
      throw new InvalidSpeakerError(
        `l'indice d'un locuteur est un entier positif ou nul, reçu ${index}`,
      );
    }
    return new Speaker(index, null);
  }

  static restore(state: SpeakerState): Speaker {
    return new Speaker(state.index, state.name === null ? null : SpeakerName.restored(state.name));
  }

  withName(name: SpeakerName): Speaker {
    return new Speaker(this.index, name);
  }

  /**
   * Ce qui s'écrit devant une réplique dans un export : le nom donné, sinon « Locuteur N ».
   * Les indices du clustering commencent à 0, les humains comptent à partir de 1.
   */
  get label(): string {
    return this.name === null ? `Locuteur ${this.index + 1}` : this.name.value;
  }

  state(): SpeakerState {
    return { index: this.index, name: this.name === null ? null : this.name.value };
  }
}
