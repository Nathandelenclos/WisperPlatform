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
