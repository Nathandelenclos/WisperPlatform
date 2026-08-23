import { InvalidSpeakerError, InvalidSpeakerNameError } from './errors';

/** Serializable form of a speaker, as persisted and as exposed in the views. */
export type SpeakerState = {
  index: number;
  name: string | null;
};

/** Beyond that, it is no longer a name: it is a note pasted into a name field. */
const MAX_NAME_LENGTH = 60;

/**
 * Name given by the owner to a speaker. Immutable value object: it ends up in a subtitle
 * file, where a line is a unit of meaning — hence the refusal of anything multiline.
 */
export class SpeakerName {
  private constructor(readonly value: string) {
    Object.freeze(this);
  }

  static of(raw: string): SpeakerName {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidSpeakerNameError('a speaker name cannot be empty');
    }
    if (trimmed.length > MAX_NAME_LENGTH) {
      throw new InvalidSpeakerNameError(
        `a speaker name does not exceed ${MAX_NAME_LENGTH} characters`,
      );
    }
    // A line is a unit of meaning in a subtitle file, but `\r\n` is not the only way to
    // cut one: U+2028, U+2029 and NEL separate lines in many players, a NUL truncates a
    // label in the ones written in C, and U+202E reverses the display of the rest of the
    // line. A person's name never contains any of them: we refuse whole categories rather
    // than enumerate the nuisances.
    if (/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(trimmed)) {
      throw new InvalidSpeakerNameError(
        'a speaker name fits on a single line, with no control character',
      );
    }
    return new SpeakerName(trimmed);
  }

  /**
   * Faithful read-back from storage: no revalidation. A name written under a broader rule
   * must not make its aggregate unrecoverable.
   */
  static restored(value: string): SpeakerName {
    return new SpeakerName(value);
  }
}

/**
 * The index of a speaker: the rank the diarization clustering gave them.
 *
 * Single home of the invariant. It was copied into every gate of the domain, so every new
 * gate copied it or forgot it — `Segment.withSpeaker` had forgotten it, and a negative index
 * went through it all the way to the rendering of an export, which threw instead of rendering.
 */
export function assertSpeakerIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0) {
    throw new InvalidSpeakerError(
      `a speaker index is a non-negative integer, received ${index}`,
    );
  }
}

/**
 * A speaker of a transcription: the technical index produced by the diarization clustering,
 * and the name the owner may have given them.
 * Immutable value object — renaming produces a new instance.
 */
export class Speaker {
  private constructor(
    readonly index: number,
    readonly name: SpeakerName | null,
  ) {
    Object.freeze(this);
  }

  /** Speaker as diarization delivers them: an index, no name yet. */
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
   * What is written in front of a line of dialogue in an export: the given name, otherwise
   * "Speaker N". The clustering indices start at 0, humans count from 1.
   */
  get label(): string {
    return this.name === null ? `Speaker ${this.index + 1}` : this.name.value;
  }

  state(): SpeakerState {
    return { index: this.index, name: this.name === null ? null : this.name.value };
  }
}
