/**
 * Display formatting. No state of its own, no dependency: everything locale-dependent goes
 * through `Intl`, which already knows the separators, the unit names and the plural rules of
 * every locale — none of that is worth reimplementing, and a hand-written table of units is
 * wrong the day a locale is added.
 */

export type Formatters = {
  /** Written form a count takes here — English says "0 segments", French "0 segment". */
  plural: (count: number) => Intl.LDMLPluralRule;
  number: (value: number) => string;
  /** Spoken duration, for the library: `1 hr 04 min`, `12 min 30 sec`, `18 sec`. */
  duration: (milliseconds: number) => string;
  byteSize: (bytes: number) => string;
  /** ISO date returned by the API → readable local date. */
  dateTime: (iso: string) => string;
  /** ISO date → “3 minutes ago”, “yesterday”. */
  relativeTime: (iso: string) => string;
};

/** Decreasing steps: the first unit actually reached wins. */
const RELATIVE_STEPS: readonly { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: 'year', ms: 365 * 86_400_000 },
  { unit: 'month', ms: 30 * 86_400_000 },
  { unit: 'day', ms: 86_400_000 },
  { unit: 'hour', ms: 3_600_000 },
  { unit: 'minute', ms: 60_000 },
];

/** Largest first. SI multiples, so 1000 and not 1024 — which is what the unit names claim. */
const BYTE_UNITS: readonly { unit: string; scale: number }[] = [
  { unit: 'terabyte', scale: 1e12 },
  { unit: 'gigabyte', scale: 1e9 },
  { unit: 'megabyte', scale: 1e6 },
  { unit: 'kilobyte', scale: 1e3 },
  { unit: 'byte', scale: 1 },
];

function build(locale: string): Formatters {
  // Everything is constructed once per locale: an `Intl` constructor loads locale data, and
  // that has no business running on every render of a list of a thousand lines.
  const plurals = new Intl.PluralRules(locale);
  const numbers = new Intl.NumberFormat(locale);
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  const unit = (name: string, options: Intl.NumberFormatOptions = {}): Intl.NumberFormat =>
    new Intl.NumberFormat(locale, { style: 'unit', unitDisplay: 'short', unit: name, ...options });

  // Two digits on the trailing unit: `1 hr 04 min` reads as one duration, `1 hr 4 min` reads
  // as two separate numbers.
  const padded = { minimumIntegerDigits: 2 };
  const hourUnit = unit('hour');
  const minuteUnit = unit('minute');
  const paddedMinuteUnit = unit('minute', padded);
  const secondUnit = unit('second');
  const paddedSecondUnit = unit('second', padded);

  const byteSteps = BYTE_UNITS.map((step) => ({
    scale: step.scale,
    format: unit(step.unit, { maximumFractionDigits: 1 }),
  }));

  return {
    plural: (count) => plurals.select(count),
    number: (value) => numbers.format(value),

    duration: (milliseconds) => {
      const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
      const seconds = totalSeconds % 60;
      const minutes = Math.floor(totalSeconds / 60) % 60;
      const hours = Math.floor(totalSeconds / 3600);
      if (hours > 0) {
        return `${hourUnit.format(hours)} ${paddedMinuteUnit.format(minutes)}`;
      }
      if (minutes > 0) {
        return `${minuteUnit.format(minutes)} ${paddedSecondUnit.format(seconds)}`;
      }
      return secondUnit.format(seconds);
    },

    byteSize: (bytes) => {
      const value = Math.max(0, bytes);
      // Below one byte there is no step to reach: the last one (bytes) is the floor.
      const step =
        byteSteps.find((candidate) => value >= candidate.scale) ?? byteSteps[byteSteps.length - 1];
      return step.format.format(value / step.scale);
    },

    dateTime: (iso) => {
      const date = new Date(iso);
      return Number.isNaN(date.getTime()) ? '—' : dateTime.format(date);
    },

    relativeTime: (iso) => {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return '—';
      const elapsed = Date.now() - date.getTime();
      for (const step of RELATIVE_STEPS) {
        // A skewed clock can produce a date in the future: “in 2 minutes” stays truthful.
        if (Math.abs(elapsed) >= step.ms) {
          return relative.format(-Math.round(elapsed / step.ms), step.unit);
        }
      }
      // Under a minute: the locale writes its own wording rather than a catalogue entry.
      return relative.format(0, 'second');
    },
  };
}

/** One entry per locale actually used in the session — inserted at runtime, hence a `Map`. */
const built = new Map<string, Formatters>();

/** Formatters bound to a locale. Same locale, same object: identity is stable across renders. */
export function formatters(locale: string): Formatters {
  const cached = built.get(locale);
  if (cached !== undefined) return cached;
  const fresh = build(locale);
  built.set(locale, fresh);
  return fresh;
}

/**
 * Position in the media: `mm:ss`, prefixed with hours past one hour. No tenths: the timecode
 * is a navigation button in the transcript, and a precision no gesture exploits is only noise
 * in a column of figures. Digits stay ASCII in every locale — a media timecode is not a number
 * to be read, it is a coordinate to be matched against the player's own display.
 */
export function formatTimecode(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const base = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return hours > 0 ? `${hours}:${base}` : base;
}
