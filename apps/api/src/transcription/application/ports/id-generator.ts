/** Fabrique d'identifiants opaques (uuid v4) : identifiants d'aggregate, de run, clés de stockage. */
export interface IdGenerator {
  next(): string;
}

export const ID_GENERATOR = Symbol('IdGenerator');
