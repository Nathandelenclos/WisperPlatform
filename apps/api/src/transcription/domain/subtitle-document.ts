import { DomainError } from './errors';
import type { Segment } from './segment';

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

/** Rend les segments dans un format de sous-titres téléchargeable. */
export function renderSubtitles(segments: readonly Segment[], format: SubtitleFormat): string {
  switch (format) {
    case 'srt':
      return segments
        .map(
          (segment, index) =>
            `${index + 1}\n` +
            `${formatTimestamp(segment.range.startMs, ',')} --> ` +
            `${formatTimestamp(segment.range.endMs, ',')}\n${segment.text}\n`,
        )
        .join('\n');
    case 'vtt':
      return (
        'WEBVTT\n\n' +
        segments
          .map(
            (segment) =>
              `${formatTimestamp(segment.range.startMs, '.')} --> ` +
              `${formatTimestamp(segment.range.endMs, '.')}\n${segment.text}\n`,
          )
          .join('\n')
      );
    case 'txt':
      return segments.map((segment) => `${segment.text}\n`).join('');
    default:
      throw new DomainError(
        'UNSUPPORTED_SUBTITLE_FORMAT',
        `format de sous-titres inconnu : ${String(format)}`,
      );
  }
}
