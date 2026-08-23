/** Fabrique d'identifiants opaques (uuid v4) : identifiants de clé de machine. */
export interface IdGenerator {
  next(): string;
}

export const ID_GENERATOR = Symbol('WorkersIdGenerator');
