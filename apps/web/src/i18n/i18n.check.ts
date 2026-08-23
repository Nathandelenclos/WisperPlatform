/**
 * Self-check of the catalogue and of the translation function. Not imported by the
 * application: it is built and run on demand, from `apps/web`, with the tools already in the
 * package — no test framework, no fixture, no new dependency.
 *
 *   node_modules/.bin/vite build --ssr src/i18n/i18n.check.ts --outDir /tmp/wisper-i18n-check \
 *     --logLevel warn && node /tmp/wisper-i18n-check/i18n.check.js
 *
 * What it defends: the plural form is the locale's, not `count === 1` (French writes
 * “0 segment”, English “0 segments”), numbers and units are formatted for the locale, a
 * missing placeholder stays visible, and both catalogues carry exactly the same keys.
 *
 * A thrown error is the failure: `node:assert` would need `@types/node`, which this package
 * deliberately does not depend on.
 */
import { formatters } from '../format';
import { en } from './en';
import { fr } from './fr';
import { translator } from './translate';

function equal(actual: string, expected: string, what: string): void {
  if (actual === expected) return;
  throw new Error(`${what}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

const t = { en: translator(en, formatters('en')), fr: translator(fr, formatters('fr')) };

// Plural: the divergence at zero is the whole reason `Intl.PluralRules` is here.
equal(t.en('library.segments', { count: 0 }), '0 segments', 'en zero');
equal(t.fr('library.segments', { count: 0 }), '0 segment', 'fr zero');
equal(t.en('library.segments', { count: 1 }), '1 segment', 'en one');
equal(t.fr('library.segments', { count: 1 }), '1 segment', 'fr one');
equal(t.en('library.segments', { count: 12 }), '12 segments', 'en many');
equal(t.fr('library.segments', { count: 12 }), '12 segments', 'fr many');

// A count is a number in a sentence: it is written the way the locale writes numbers. French
// groups with U+202F, a narrow no-break space — spelled out here so the literal cannot lie.
equal(t.en('library.segments', { count: 1234 }), '1,234 segments', 'en grouping');
equal(t.fr('library.segments', { count: 1234 }), '1\u202f234 segments', 'fr grouping');

// Named interpolation, and a placeholder left visible when its value is missing.
equal(t.en('speaker.fallbackName', { index: 3 }), 'Speaker 3', 'en speaker');
equal(t.fr('speaker.fallbackName', { index: 3 }), 'Locuteur 3', 'fr speaker');
equal(t.en('speaker.fallbackName'), 'Speaker {index}', 'missing param');
equal(t.en('machines.secretTitle', { label: 'laptop' }), 'Key for “laptop”', 'en label');

// Same keys on both sides. The type already forbids drift; this catches a catalogue read from
// somewhere other than the compiler — a copy, a merge, a hand edit.
equal(Object.keys(en).sort().join('\n'), Object.keys(fr).sort().join('\n'), 'key sets');

// Formats follow the locale. French binds its units with non-breaking spaces (U+202F, U+00A0),
// which is exactly why no unit label is hand-written.
equal(formatters('en').byteSize(988_900), '988.9 kB', 'en bytes');
equal(formatters('fr').byteSize(988_900), '988,9\u202fko', 'fr bytes');
equal(formatters('en').duration(3_840_000), '1 hr 04 min', 'en hours');
equal(formatters('fr').duration(3_840_000), '1\u202fh 04\u00a0min', 'fr hours');
equal(formatters('en').duration(18_000), '18 sec', 'en seconds');
equal(formatters('fr').duration(18_000), '18\u202fs', 'fr seconds');

const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
equal(formatters('en').relativeTime(hourAgo), '1 hour ago', 'en relative');
equal(formatters('fr').relativeTime(hourAgo), 'il y a 1 heure', 'fr relative');
// Under a minute the locale writes its own wording, and a broken date never renders as NaN.
equal(formatters('en').relativeTime(new Date().toISOString()), 'now', 'en just now');
equal(formatters('en').dateTime('not a date'), '—', 'invalid date');

console.log(`i18n check passed — ${Object.keys(en).length} keys, en/fr in step.`);
