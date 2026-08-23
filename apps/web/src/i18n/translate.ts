import type { Formatters } from '../format';
import type { MessageKey, Messages } from './en';

/** Values substituted into `{name}` placeholders. `count` also picks the plural form. */
export type Params = Readonly<Record<string, string | number>>;

export type Translate = (key: MessageKey, params?: Params) => string;

/**
 * Reads a message and fills it in. Two rules, and nothing else: the plural form is chosen by
 * `Intl.PluralRules` — English writes “0 segments” where French writes “0 segment” — and a
 * numeric value is formatted for the locale rather than pasted in raw.
 */
export function translator(messages: Messages, format: Formatters): Translate {
  return (key, params) => {
    const entry = messages[key];
    const text =
      typeof entry === 'string'
        ? entry
        : typeof params?.count === 'number' && format.plural(params.count) === 'one'
          ? entry.one
          : entry.other;

    if (params === undefined) return text;
    return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
      // A missing value leaves its placeholder in place: visible in review, rather than a
      // sentence that silently loses a word.
      if (!(name in params)) return placeholder;
      const value = params[name];
      return typeof value === 'number' ? format.number(value) : value;
    });
  };
}
