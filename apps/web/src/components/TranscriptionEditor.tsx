import { useCallback, useRef, useState } from 'react';
import type { SubtitleFormat, TranscriptionView } from '../api/transcriptions';
import { formatByteSize, formatDateTime } from '../format';
import { SegmentRow } from './SegmentRow';
import { StatusBadge } from './StatusBadge';

const EXPORTS: readonly { format: SubtitleFormat; label: string }[] = [
  { format: 'srt', label: 'SRT' },
  { format: 'vtt', label: 'VTT' },
  { format: 'txt', label: 'Texte brut' },
];

type TranscriptionEditorProps = {
  transcription: TranscriptionView;
  mediaUrl: string;
  buildExportUrl: (format: SubtitleFormat) => string;
  /** Segment en cours d'enregistrement, s'il y en a un. */
  savingOrdinal: number | null;
  errorMessage: string | null;
  onCorrectSegment: (correction: { ordinal: number; text: string }) => void;
};

/**
 * Lecture du média et correction des segments. L'état de lecture (segment courant,
 * position) est purement visuel et reste ici ; les corrections partent en callback.
 */
export function TranscriptionEditor({
  transcription,
  mediaUrl,
  buildExportUrl,
  savingOrdinal,
  errorMessage,
  onCorrectSegment,
}: TranscriptionEditorProps) {
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const [currentOrdinal, setCurrentOrdinal] = useState<number | null>(null);

  const { segments, status } = transcription;
  const isVideo = transcription.mediaContentType.startsWith('video/');

  // Identité stable : un ref-callback recréé à chaque rendu serait détaché/rattaché.
  const attachMedia = useCallback((node: HTMLMediaElement | null) => {
    mediaRef.current = node;
  }, []);

  const followPlayback = () => {
    const media = mediaRef.current;
    if (media === null) return;
    const positionMs = media.currentTime * 1000;
    const active = segments.find(
      (segment) => positionMs >= segment.startMs && positionMs < segment.endMs,
    );
    setCurrentOrdinal(active === undefined ? null : active.ordinal);
  };

  const seek = (startMs: number) => {
    const media = mediaRef.current;
    if (media === null) return;
    media.currentTime = startMs / 1000;
    void media.play().catch(() => {
      // Lecture refusée par le navigateur : le déplacement de la tête de lecture suffit.
    });
  };

  return (
    <section className="editor" aria-labelledby="editor-title">
      <header className="editor__header">
        <h2 className="editor__title" id="editor-title">
          {transcription.mediaName}
        </h2>
        <div className="editor__facts">
          <StatusBadge status={status} />
          <span>{transcription.model}</span>
          <span aria-hidden="true">·</span>
          <span>{transcription.language}</span>
          <span aria-hidden="true">·</span>
          <span>{formatByteSize(transcription.mediaByteSize)}</span>
          <span aria-hidden="true">·</span>
          <span>déposé le {formatDateTime(transcription.requestedAt)}</span>
        </div>
      </header>

      {isVideo ? (
        <video
          className="player player--video"
          ref={attachMedia}
          src={mediaUrl}
          controls
          preload="metadata"
          onTimeUpdate={followPlayback}
        />
      ) : (
        <audio
          className="player"
          ref={attachMedia}
          src={mediaUrl}
          controls
          preload="metadata"
          onTimeUpdate={followPlayback}
        />
      )}

      {status === 'failed' ? (
        <p className="notice notice--error" role="alert">
          La transcription a échoué{transcription.failureReason === null ? '' : ` : ${transcription.failureReason}`}.
        </p>
      ) : null}

      {errorMessage === null ? null : (
        <p className="notice notice--error" role="alert">
          {errorMessage}
        </p>
      )}

      {status === 'transcribing' ? (
        <p className="live" role="status">
          <span className="live__dot" aria-hidden="true" />
          Transcription en cours — les phrases s'ajoutent au fil de l'eau.
        </p>
      ) : null}

      {status === 'pending' ? (
        <p className="notice" role="status">
          En file d'attente : la transcription démarrera dès qu'un worker sera libre.
        </p>
      ) : null}

      {segments.length > 0 ? (
        <div className="editor__exports">
          <span className="editor__exports-label">Exporter&nbsp;:</span>
          {EXPORTS.map((option) => (
            <a
              className="button button--ghost"
              key={option.format}
              href={buildExportUrl(option.format)}
              download
            >
              {option.label}
            </a>
          ))}
        </div>
      ) : null}

      {segments.length === 0 && status === 'completed' ? (
        <p className="empty">Aucune parole détectée dans ce média.</p>
      ) : null}

      <ol className="segments">
        {segments.map((segment) => (
          <SegmentRow
            key={segment.ordinal}
            segment={segment}
            current={segment.ordinal === currentOrdinal}
            saving={segment.ordinal === savingOrdinal}
            onSeek={seek}
            onCommit={(text) => onCorrectSegment({ ordinal: segment.ordinal, text })}
          />
        ))}
      </ol>
    </section>
  );
}
