/**
 * Journal structuré. Les champs sont des données techniques : jamais d'email, de jeton,
 * ni de nom de fichier utilisateur.
 */
export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  debug(message: string, fields?: Record<string, unknown>): void;
}

export const LOGGER = Symbol('Logger');
