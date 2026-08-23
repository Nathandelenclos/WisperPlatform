import { LOCALES, LOCALE_NAMES, useTranslation } from '../i18n';
import { Select, VisuallyHidden } from './primitives';

/**
 * Choice of interface language. A native `<select>`: keyboard, type-ahead and the phone wheel
 * come for free, and two options do not warrant building anything that opens.
 *
 * Each language is written in its own language — someone who cannot read the current one has to
 * recognise their own in the list, so “French” would be of no use to them. The visible value is
 * therefore already the label; the accessible name is carried by a hidden one, because a
 * `<select>` showing “English” gives no clue as to what it selects.
 */
export function LanguageSwitcher() {
  const { locale, setLocale, t } = useTranslation();
  const fieldId = 'language-switcher';

  return (
    <div className="language-switcher">
      <label htmlFor={fieldId}>
        <VisuallyHidden>{t('language.selectorLabel')}</VisuallyHidden>
      </label>
      <Select
        id={fieldId}
        name="locale"
        value={locale}
        onChange={(changeEvent) => {
          const chosen = LOCALES.find((candidate) => candidate === changeEvent.target.value);
          if (chosen !== undefined) setLocale(chosen);
        }}
      >
        {LOCALES.map((candidate) => (
          <option key={candidate} value={candidate}>
            {LOCALE_NAMES[candidate]}
          </option>
        ))}
      </Select>
    </div>
  );
}
