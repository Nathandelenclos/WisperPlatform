import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { TRANSCRIPTION_LANGUAGES } from '../api/transcriptions';
import { formatters, type Formatters } from '../format';
import { en, type Messages } from './en';
import { fr } from './fr';
import { translator, type Translate } from './translate';

export type { MessageKey } from './en';
export type { Translate } from './translate';

export type Locale = 'en' | 'fr';

/** English first: it is the reference catalogue, and the fallback when nothing else matches. */
export const LOCALES: readonly Locale[] = ['en', 'fr'];

const CATALOGUES: Record<Locale, Messages> = { en, fr };

/**
 * Each language written in its own language. Someone who cannot read the current interface has
 * to recognise their own tongue in the list — “French” would be useless to them.
 */
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', fr: 'Français' };

export type Translation = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
  format: Formatters;
};

const STORAGE_KEY = 'wisper.locale';

function isLocale(value: string | null): value is Locale {
  return value === 'en' || value === 'fr';
}

/**
 * The remembered choice wins; failing that, the browser's ordered preferences, which is what
 * the user already told their system. English is the floor, being the reference catalogue.
 *
 * Reading `localStorage` can throw outright (private mode, storage blocked by policy): a
 * language preference is not worth a blank page.
 */
function detectLocale(): Locale {
  try {
    const remembered = localStorage.getItem(STORAGE_KEY);
    if (isLocale(remembered)) return remembered;
  } catch {
    // Storage denied: detection below still works, only the memory of the choice is lost.
  }
  for (const tag of navigator.languages) {
    // `fr-CA` and `fr` are the same catalogue here: only the base subtag is matched.
    const base = tag.split('-')[0].toLowerCase();
    if (isLocale(base)) return base;
  }
  return 'en';
}

const TranslationContext = createContext<Translation | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState(detectLocale);

  useEffect(() => {
    // A screen reader switches voice on this attribute: it has to follow the choice, not the
    // value the document was served with.
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<Translation>(() => {
    const format = formatters(locale);
    return {
      locale,
      setLocale: (next) => {
        try {
          localStorage.setItem(STORAGE_KEY, next);
        } catch {
          // Storage denied: the choice holds for this visit and is detected again on the next.
        }
        setLocale(next);
      },
      t: translator(CATALOGUES[locale], format),
      format,
    };
  }, [locale]);

  return <TranslationContext.Provider value={value}>{children}</TranslationContext.Provider>;
}

export function useTranslation(): Translation {
  const value = useContext(TranslationContext);
  if (value === null) throw new Error('useTranslation() used outside <I18nProvider>.');
  return value;
}

/**
 * Name of a spoken language, in the reader's language. An unknown value — a transcription
 * requested before the list changed — is shown raw rather than dropped: it is still what the
 * worker was asked for.
 */
export function languageLabel(language: string, t: Translate): string {
  const known = TRANSCRIPTION_LANGUAGES.find((candidate) => candidate === language);
  return known === undefined ? language : t(`language.${known}`);
}
