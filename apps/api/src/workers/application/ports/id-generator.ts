/** Factory of opaque identifiers (uuid v4): machine key identifiers. */
export interface IdGenerator {
  next(): string;
}

export const ID_GENERATOR = Symbol('WorkersIdGenerator');
