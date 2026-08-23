/** Opaque identifier factory (uuid v4): aggregate ids, run ids, storage keys. */
export interface IdGenerator {
  next(): string;
}

export const ID_GENERATOR = Symbol('IdGenerator');
