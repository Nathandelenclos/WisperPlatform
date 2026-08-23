import { useCallback, useEffect, useRef, useState, type ReactEventHandler } from 'react';
import {
  type Placement,
  type Segment,
  type SubtitleFormat,
  type TranscriptionStatus,
  type TranscriptionView,
} from '../api/transcriptions';
import { formatTimecode } from '../format';
import { languageLabel, useTranslation, type Translate } from '../i18n';
import { ExportMenu } from './ExportMenu';
import { SegmentRow } from './SegmentRow';
import { SpeakerTurn } from './SpeakerTurn';
import { Button, EmptyState, Notice, Skeleton, StatusPill, VisuallyHidden } from './primitives';

/** Starting over, here, means uploading a media file again: the anchor leads to the drop panel. */
const UPLOAD_ANCHOR = '#upload-panel';

/** What the media actually has to show, known only once its metadata has been read. */
type Picture = 'unknown' | 'present' | 'absent';

/**
 * A transcription can last minutes: the screen always says where the work stands, and the
 * number of segments that arrived is the only honest measure of its progress.
 */
function describeProgress(
  status: TranscriptionStatus,
  count: number,
  placement: Placement,
  t: Translate,
): string {
  switch (status) {
    case 'pending':
      return placement === 'owner'
        ? t('transcript.progressPendingOwner')
        : t('transcript.progressPendingService');
    case 'transcribing':
      return t('transcript.progressTranscribing', { count });
    case 'completed':
      return t('transcript.progressCompleted', { count });
    case 'failed':
      return count === 0
        ? t('transcript.progressFailedEmpty')
        : t('transcript.progressFailed', { count });
  }
}

type TranscriptionEditorProps = {
  transcription: TranscriptionView;
  mediaUrl: string;
  buildExportUrl: (format: SubtitleFormat) => string;
  /** Segment currently being saved, if there is one. */
  savingOrdinal: number | null;
  errorMessage: string | null;
  /** The event stream is cut: the view no longer moves live. */
  streamLost: boolean;
  onRetryStream: () => void;
  onCorrectSegment: (correction: { ordinal: number; text: string }) => void;
  /** Speaker currently being renamed, if there is one. */
  renamingSpeakerIndex: number | null;
  renameErrorMessage: string | null;
  onRenameSpeaker: (rename: { index: number; name: string }) => void;
  /** Placement switch under way: the take-back gesture is busy. */
  movingToService: boolean;
  placementErrorMessage: string | null;
  onMoveToService: () => void;
};

/**
 * Media playback and segment correction. The playback state (current segment, position, scroll
 * following) is purely visual and stays here; corrections leave through callbacks.
 */
export function TranscriptionEditor({
  transcription,
  mediaUrl,
  buildExportUrl,
  savingOrdinal,
  errorMessage,
  streamLost,
  onRetryStream,
  onCorrectSegment,
  renamingSpeakerIndex,
  renameErrorMessage,
  onRenameSpeaker,
  movingToService,
  placementErrorMessage,
  onMoveToService,
}: TranscriptionEditorProps) {
  const { t, format } = useTranslation();
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);
  // Last known position, in milliseconds: it survives the video → audio switch.
  const positionRef = useRef(0);
  // Highlighted segment, also kept in a ref to settle a `timeupdate` without re-rendering.
  const heldRef = useRef<Segment | null>(null);

  const [currentOrdinal, setCurrentOrdinal] = useState<number | null>(null);
  const [fieldFocused, setFieldFocused] = useState(false);
  const [follow, setFollow] = useState(false);
  const [picture, setPicture] = useState<Picture>('unknown');
  const [announcement, setAnnouncement] = useState<{ token: number; text: string } | null>(null);
  // Turn whose rename form is open, designated by the ordinal of the segment that opens it: a
  // speaker may have twenty turns, but only one field at a time.
  const [openTurn, setOpenTurn] = useState<number | null>(null);

  const { segments, speakers, status, placement } = transcription;
  const isVideo = transcription.mediaContentType.startsWith('video/');
  // A video container may hold no usable picture — a `.mov` recorded from a microphone, for
  // instance. Showing a black rectangle would lie about what the file contains.
  const soundOnly = isVideo && picture === 'absent';
  // The domain only corrects a segment on a finished transcription.
  const editable = status === 'completed';
  // A new attempt empties the list: the field that had the focus went with it, and the browser
  // does not guarantee a `blur` on a removed element. Without this guard, the following setting
  // would stay disabled for good.
  const editing = fieldFocused && segments.length > 0;

  const spokenMs = segments.at(-1)?.endMs ?? null;
  // A request reserved for the owner's machines that has not started: it is the only case where
  // they have a decision to take back, and they must be able to take it back by hand.
  const stuckOnOwnMachine = status === 'pending' && placement === 'owner';

  /** A live region does not repeat itself: the token forces it to be read again. */
  const announce = useCallback((text: string) => {
    setAnnouncement((current) => ({ token: (current?.token ?? 0) + 1, text }));
  }, []);

  // Stable identity: a ref callback recreated on every render would be detached/reattached.
  const attachMedia = useCallback((node: HTMLMediaElement | null) => {
    mediaRef.current = node;
    // Carrying the playhead over when the element changes nature (video → audio).
    if (node !== null && positionRef.current > 0) node.currentTime = positionRef.current / 1000;
  }, []);

  const followPlayback = () => {
    const media = mediaRef.current;
    if (media === null) return;
    const positionMs = media.currentTime * 1000;
    positionRef.current = positionMs;

    // Common case, four times a second: playback advances inside the segment already
    // highlighted. Nothing to look for, nothing to re-render — a transcript can hold thousands
    // of lines and has no reason to redraw itself on every beat.
    const held = heldRef.current;
    if (held !== null && positionMs >= held.startMs && positionMs < held.endMs) return;

    const active =
      segments.find((segment) => positionMs >= segment.startMs && positionMs < segment.endMs) ??
      null;
    heldRef.current = active;
    setCurrentOrdinal(active === null ? null : active.ordinal);
  };

  const inspectPicture: ReactEventHandler<HTMLVideoElement> = (event) => {
    const media = event.currentTarget;
    setPicture(media.videoWidth === 0 || media.videoHeight === 0 ? 'absent' : 'present');
  };

  const seek = (startMs: number) => {
    const media = mediaRef.current;
    if (media === null) return;
    media.currentTime = startMs / 1000;
    void media.play().catch(() => {
      // Playback refused by the browser: moving the playhead is enough.
    });
  };

  // A single reference for the whole list: the ordinal comes back as an argument rather than
  // being captured in one closure per row.
  const commitSegment = (ordinal: number, text: string) => onCorrectSegment({ ordinal, text });

  // Playback following: never during a correction, and `nearest` moves nothing as long as the
  // segment being played is already on screen. No `behavior` asked for: the scroll follows the
  // system motion preference, set in the base stylesheet.
  useEffect(() => {
    if (!follow || editing || currentOrdinal === null) return;
    listRef.current
      ?.querySelector(`[data-ordinal="${currentOrdinal}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [follow, editing, currentOrdinal]);

  // The fate of a correction is announced, not merely coloured: the end of the save is read
  // from the disappearance of `savingOrdinal`, and the error, if any, comes with it.
  const previousSaving = useRef<number | null>(null);
  useEffect(() => {
    const previous = previousSaving.current;
    previousSaving.current = savingOrdinal;
    if (previous === null || previous === savingOrdinal) return;
    const saved = segments.find((segment) => segment.ordinal === previous);
    const at = saved === undefined ? null : formatTimecode(saved.startMs);
    if (errorMessage === null) {
      announce(at === null ? t('transcript.announceSaved') : t('transcript.announceSavedAt', { at }));
      return;
    }
    announce(
      at === null
        ? t('transcript.announceNotSaved', { reason: errorMessage })
        : t('transcript.announceNotSavedAt', { at, reason: errorMessage }),
    );
  }, [savingOrdinal, errorMessage, segments, announce, t]);

  // The fate of a rename is heard too. The end of the submission is read from the disappearance
  // of `renamingSpeakerIndex`; the form only closes if the server accepted, otherwise the
  // correction is replayed where it was typed.
  const previousRenaming = useRef<number | null>(null);
  useEffect(() => {
    const previous = previousRenaming.current;
    previousRenaming.current = renamingSpeakerIndex;
    if (previous === null || previous === renamingSpeakerIndex) return;
    if (renameErrorMessage !== null) {
      announce(t('transcript.announceRenameFailed', { reason: renameErrorMessage }));
      return;
    }
    setOpenTurn(null);
    const renamed = speakers.find((speaker) => speaker.index === previous)?.name ?? null;
    announce(
      renamed === null
        ? t('transcript.announceRenamed')
        : t('transcript.announceRenamedTo', { name: renamed }),
    );
  }, [renamingSpeakerIndex, renameErrorMessage, speakers, announce, t]);

  // A lost stream is seen — and heard: the banner is no use to whoever cannot see it.
  const previousLost = useRef(streamLost);
  useEffect(() => {
    if (previousLost.current === streamLost) return;
    previousLost.current = streamLost;
    announce(
      streamLost ? t('transcript.announceStreamLost') : t('transcript.announceStreamBack'),
    );
  }, [streamLost, announce, t]);

  return (
    <article className="transcript" aria-labelledby="transcript-title">
      <header className="transcript__header">
        <div className="transcript__heading">
          <h2 className="transcript__title" id="transcript-title">
            {transcription.mediaName}
          </h2>
          <StatusPill status={status} />
        </div>

        <dl className="transcript__facts">
          <div className="transcript__fact">
            <dt>{t('transcript.factModel')}</dt>
            <dd>{transcription.model}</dd>
          </div>
          <div className="transcript__fact">
            <dt>{t('transcript.factLanguage')}</dt>
            <dd>{languageLabel(transcription.language, t)}</dd>
          </div>
          <div className="transcript__fact">
            <dt>{t('transcript.factMedia')}</dt>
            <dd>{format.byteSize(transcription.mediaByteSize)}</dd>
          </div>
          <div className="transcript__fact">
            <dt>{t('transcript.factUploaded')}</dt>
            <dd>{format.dateTime(transcription.requestedAt)}</dd>
          </div>
          {/* A fact shown only when it is out of the ordinary: “service” is the default. */}
          {placement === 'owner' ? (
            <div className="transcript__fact">
              <dt>{t('transcript.factComputation')}</dt>
              <dd>{t('transcript.factYourMachine')}</dd>
            </div>
          ) : null}
          {spokenMs === null ? null : (
            <div className="transcript__fact">
              <dt>{t('transcript.factSpeech')}</dt>
              <dd>{format.duration(spokenMs)}</dd>
            </div>
          )}
        </dl>
      </header>

      <div className="media-player">
        {isVideo && !soundOnly ? (
          <video
            className="media-player__video"
            ref={attachMedia}
            src={mediaUrl}
            controls
            preload="metadata"
            onLoadedMetadata={inspectPicture}
            onTimeUpdate={followPlayback}
          />
        ) : (
          <audio
            className="media-player__audio"
            ref={attachMedia}
            src={mediaUrl}
            controls
            preload="metadata"
            onTimeUpdate={followPlayback}
          />
        )}
        {soundOnly ? <p className="media-player__note">{t('transcript.soundOnly')}</p> : null}
      </div>

      {status === 'failed' ? (
        <Notice
          tone="error"
          title={t('transcript.failedTitle')}
          action={
            <a className="transcript__action" href={UPLOAD_ANCHOR}>
              {t('transcript.uploadAgain')}
            </a>
          }
        >
          {transcription.failureReason === null
            ? t('transcript.failedNoReason')
            : transcription.failureReason}
        </Notice>
      ) : null}

      {/*
        Reserved for the owner's machines: it may wait indefinitely, and nothing will move it on
        its own. The screen states the real wait and offers the only way out that exists —
        handing the computing to the service. The decision stays theirs.
      */}
      {stuckOnOwnMachine ? (
        <Notice
          tone="info"
          title={t('transcript.waitingOwnMachineTitle')}
          action={
            <Button
              variant="secondary"
              size="sm"
              loading={movingToService}
              onClick={onMoveToService}
            >
              {t('transcript.handToService')}
            </Button>
          }
        >
          {t('transcript.waitingOwnMachineBody')}
        </Notice>
      ) : null}

      {placementErrorMessage === null ? null : (
        <Notice tone="error" title={t('transcript.notMovedTitle')}>
          {placementErrorMessage}
        </Notice>
      )}

      {errorMessage === null ? null : <Notice tone="error">{errorMessage}</Notice>}

      {streamLost ? (
        <Notice
          tone="warning"
          title={t('transcript.streamLostTitle')}
          action={
            <Button variant="secondary" size="sm" onClick={onRetryStream}>
              {t('transcript.reconnect')}
            </Button>
          }
        >
          {t('transcript.streamLostBody')}
        </Notice>
      ) : null}

      {(status === 'pending' || status === 'transcribing') && segments.length > 0 ? (
        <Notice tone="info">{t('transcript.readOnly')}</Notice>
      ) : null}

      <div className="panel transcript__tools">
        <div className="transcript__playback">
          <label className="transcript__follow">
            <input
              type="checkbox"
              checked={follow}
              disabled={editing}
              aria-describedby="follow-hint"
              onChange={(changeEvent) => setFollow(changeEvent.target.checked)}
            />
            <span>{t('transcript.follow')}</span>
          </label>
          <p className="transcript__hint" id="follow-hint">
            {t('transcript.followHint')}
          </p>
        </div>

        {segments.length > 0 ? <ExportMenu buildUrl={buildExportUrl} /> : null}
      </div>

      <p className="transcript__progress" role="status">
        {describeProgress(status, segments.length, placement, t)}
      </p>

      {segments.length === 0 && status === 'completed' ? (
        <EmptyState
          title={t('transcript.noSpeechTitle')}
          description={t('transcript.noSpeechDescription')}
          action={
            <a className="transcript__action" href={UPLOAD_ANCHOR}>
              {t('transcript.uploadAnother')}
            </a>
          }
        />
      ) : null}

      {segments.length > 0 || status === 'transcribing' ? (
        <ol className="transcript__segments" ref={listRef}>
          {segments.map((segment, position) => {
            // Speaker label only on a CHANGE of turn: a conversation is read in turns, and the
            // same name repeated on every line is nothing but noise.
            // An index absent from the reading model keeps its rank for a name: better a turn
            // named by default than a turn erased.
            const previousSpeaker = position === 0 ? null : segments[position - 1].speakerIndex;
            const { speakerIndex } = segment;
            const speaker =
              speakerIndex === null || speakerIndex === previousSpeaker
                ? null
                : (speakers.find((candidate) => candidate.index === speakerIndex) ?? {
                    index: speakerIndex,
                    name: null,
                  });

            return (
              <SegmentRow
                key={segment.ordinal}
                segment={segment}
                speakerHead={
                  speaker === null ? null : (
                    <SpeakerTurn
                      speaker={speaker}
                      editing={openTurn === segment.ordinal}
                      saving={renamingSpeakerIndex === speaker.index}
                      error={openTurn === segment.ordinal ? renameErrorMessage : null}
                      onOpen={() => setOpenTurn(segment.ordinal)}
                      onCancel={() => setOpenTurn(null)}
                      onCommit={(name) => onRenameSpeaker({ index: speaker.index, name })}
                    />
                  )
                }
                current={segment.ordinal === currentOrdinal}
                editable={editable}
                saving={segment.ordinal === savingOrdinal}
                onSeek={seek}
                onCommit={commitSegment}
                onEditingChange={setFieldFocused}
              />
            );
          })}

          {status === 'transcribing' && !streamLost ? (
            // Ghost row: the space of the next segment is reserved at the bottom of the list,
            // where nothing already read can be shifted. Mute for assistive technology — the
            // progress line already says the work is going on.
            <li className="segment segment--ghost" aria-hidden="true">
              <span className="segment__timecode segment__timecode--ghost" />
              <div className="segment__body">
                <Skeleton lines={2} />
              </div>
            </li>
          ) : null}
        </ol>
      ) : null}

      <VisuallyHidden>
        <span role="status">
          {announcement === null ? null : <span key={announcement.token}>{announcement.text}</span>}
        </span>
      </VisuallyHidden>
    </article>
  );
}
