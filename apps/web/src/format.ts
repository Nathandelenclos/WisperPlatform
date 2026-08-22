/** Mises en forme d'affichage, sans état ni dépendance. */

const dateTimeFormat = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

const decimalFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

/**
 * Position dans le média : `mm:ss`, préfixée des heures au-delà d'une heure. Pas de
 * dixièmes : le timecode est un bouton de navigation dans le transcript, et une
 * précision qu'aucun geste n'exploite n'est que du bruit dans une colonne de chiffres.
 */
export function formatTimecode(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const base = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return hours > 0 ? `${hours}:${base}` : base;
}

/** Durée parlée, pour la liste : `1 h 04 min`, `12 min 30 s`, `18 s`. */
export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, '0')} min`;
  if (minutes > 0) return `${minutes} min ${String(seconds).padStart(2, '0')} s`;
  return `${seconds} s`;
}

const BYTE_UNITS = ['o', 'ko', 'Mo', 'Go', 'To'];

export function formatByteSize(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${decimalFormat.format(value)} ${BYTE_UNITS[unit]}`;
}

/** Date ISO renvoyée par l'API → date locale lisible. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormat.format(date);
}

const relativeFormat = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'auto' });

/** Paliers décroissants : on retient le premier dont l'unité est atteinte. */
const RELATIVE_STEPS: readonly { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: 'year', ms: 365 * 86_400_000 },
  { unit: 'month', ms: 30 * 86_400_000 },
  { unit: 'day', ms: 86_400_000 },
  { unit: 'hour', ms: 3_600_000 },
  { unit: 'minute', ms: 60_000 },
];

/**
 * Date ISO → « il y a 3 minutes », « hier ». Dans une bibliothèque, l'écart au présent se
 * lit plus vite qu'un horodatage ; la date exacte reste portée par l'attribut `datetime`.
 */
export function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const elapsed = Date.now() - date.getTime();
  for (const step of RELATIVE_STEPS) {
    // Une horloge décalée peut donner une date au futur : « dans 2 minutes » reste juste.
    if (Math.abs(elapsed) >= step.ms) {
      return relativeFormat.format(-Math.round(elapsed / step.ms), step.unit);
    }
  }
  return "à l'instant";
}
