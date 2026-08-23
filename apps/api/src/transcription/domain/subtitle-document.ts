import { DomainError } from './errors';
import type { Segment } from './segment';
import { Speaker } from './speaker';

export type SubtitleFormat = 'srt' | 'vtt' | 'txt';

const MS_PER_HOUR = 3_600_000;
const MS_PER_MINUTE = 60_000;
const MS_PER_SECOND = 1_000;

/**
 * `HH:MM:SS<sep>mmm`. Hours are always written on two digits — the decimal separator is the
 * comma in SRT and the dot in WebVTT.
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
 * Name to write in front of a line of dialogue, or `null` when the segment has no speaker —
 * and the document is then exactly the one of a transcription without diarization.
 *
 * An index missing from the list falls back on its default name: the document renders, even
 * if the list of speakers and the segments had diverged.
 */
function labelOf(segment: Segment, labels: ReadonlyMap<number, string>): string | null {
  if (segment.speakerIndex === null) {
    return null;
  }
  return labels.get(segment.speakerIndex) ?? Speaker.discovered(segment.speakerIndex).label;
}

/**
 * VTT carries markup — a voice tag ends at the first `>` — so everything that lands on the
 * payload line is escaped: the speaker name as much as the segment text. Escaping one and not
 * the other let a `</v>` typed into a correction interact with the structure of the file. SRT
 * and plain text carry no markup: nothing to escape there.
 */
function escapeVttText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Renders the segments into a downloadable subtitle format. */
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
              `${label === null ? '' : `<v ${escapeVttText(label)}>`}${escapeVttText(segment.text)}\n`
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
        `unknown subtitle format: ${String(format)}`,
      );
  }
}
