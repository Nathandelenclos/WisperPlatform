import { DomainError } from './errors';
import type { Segment } from './segment';
import { Speaker } from './speaker';

export type SubtitleFormat = 'srt' | 'vtt' | 'txt';

const MS_PER_HOUR = 3_600_000;
const MS_PER_MINUTE = 60_000;
const MS_PER_SECOND = 1_000;

/**
 * `HH:MM:SS<sep>mmm`. Les heures sont toujours écrites sur deux chiffres ; le séparateur
 * décimal est la virgule en SRT et le point en WebVTT.
 */
function formatTimestamp(totalMs: number, decimalSeparator: ',' | '.'): string {
  const hours = Math.floor(totalMs / MS_PER_HOUR);
  const minutes = Math.floor((totalMs % MS_PER_HOUR) / MS_PER_MINUTE);
  const seconds = Math.floor((totalMs % MS_PER_MINUTE) / MS_PER_SECOND);
  const milliseconds = totalMs % MS_PER_SECOND;
  return (
    `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}` +
    `:${String(seconds).padStart(2, '0')}${decimalSeparator}${String(milliseconds).padStart(3, '0')}`
  );
}

/**
 * Nom à écrire devant une réplique, ou `null` quand le segment n'a pas de locuteur — et le
 * document reste alors exactement celui d'une transcription sans diarisation.
 *
 * Un indice absent de la liste retombe sur son nom par défaut : le document se rend, même si
 * la liste des locuteurs et les segments divergeaient.
 */
function labelOf(segment: Segment, labels: ReadonlyMap<number, string>): string | null {
  if (segment.speakerIndex === null) {
    return null;
  }
  return labels.get(segment.speakerIndex) ?? Speaker.discovered(segment.speakerIndex).label;
}

/**
 * L'annotation d'une balise de voix WebVTT se termine au premier `>` : sans échappement, un
 * nom qui en contient casserait la structure du fichier.
 */
function escapeVoiceName(name: string): string {
  return name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Rend les segments dans un format de sous-titres téléchargeable. */
export function renderSubtitles(
  segments: readonly Segment[],
  format: SubtitleFormat,
  speakers: readonly Speaker[],
): string {
  const labels = new Map(speakers.map((speaker) => [speaker.index, speaker.label]));
  switch (format) {
    case 'srt':
      return segments
        .map((segment, index) => {
          const label = labelOf(segment, labels);
          return (
            `${index + 1}\n` +
            `${formatTimestamp(segment.range.startMs, ',')} --> ` +
            `${formatTimestamp(segment.range.endMs, ',')}\n` +
            `${label === null ? '' : `${label} : `}${segment.text}\n`
          );
        })
        .join('\n');
    case 'vtt':
      return (
        'WEBVTT\n\n' +
        segments
          .map((segment) => {
            const label = labelOf(segment, labels);
            return (
              `${formatTimestamp(segment.range.startMs, '.')} --> ` +
              `${formatTimestamp(segment.range.endMs, '.')}\n` +
              `${label === null ? '' : `<v ${escapeVoiceName(label)}>`}${segment.text}\n`
            );
          })
          .join('\n')
      );
    case 'txt':
      return segments
        .map((segment) => {
          const label = labelOf(segment, labels);
          return `${label === null ? '' : `${label} : `}${segment.text}\n`;
        })
        .join('');
    default:
      throw new DomainError(
        'UNSUPPORTED_SUBTITLE_FORMAT',
        `format de sous-titres inconnu : ${String(format)}`,
      );
  }
}
