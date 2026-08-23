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
    // Une ligne est une unité de sens dans un fichier de sous-titres, mais `\r\n` n'est
    // pas la seule façon de la couper : U+2028, U+2029 et NEL séparent des lignes chez
    // beaucoup de lecteurs, un NUL tronque un libellé chez ceux écrits en C, et U+202E
    // inverse l'affichage du reste de la ligne. Un nom de personne n'en contient jamais :
    // on refuse les catégories entières plutôt que d'énumérer les nuisances.
    if (/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(trimmed)) {
      throw new InvalidSpeakerNameError(
        'le nom d\'un locuteur tient sur une seule ligne, sans caractère de contrôle',
      );
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
 * L'indice d'un locuteur : le rang que le clustering de la diarisation lui a donné.
 *
 * Domicile unique de l'invariant. Il était recopié dans chaque porte du domaine, donc
 * chaque nouvelle porte le recopiait ou l'oubliait — `Segment.withSpeaker` l'avait oublié,
 * et un indice négatif y passait jusqu'au rendu d'un export, qui levait au lieu de se rendre.
 */
export function assertSpeakerIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0) {
    throw new InvalidSpeakerError(
      `l'indice d'un locuteur est un entier positif ou nul, reçu ${index}`,
    );
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
    assertSpeakerIndex(index);
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
