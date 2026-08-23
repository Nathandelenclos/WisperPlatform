import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { ApiError } from './api/http';
import {
  DEFAULT_LANGUAGE,
  DEFAULT_MODEL,
  MEDIA_MAX_BYTES,
  TRANSCRIPTION_LANGUAGES,
  WHISPER_MODELS,
  transcriptionUrls,
  type SubtitleFormat,
} from './api/transcriptions';
import { useSession } from './auth/client';
import { AuthError, MIN_PASSWORD_LENGTH, type AuthFailureCode } from './auth/session';
import { MachinesPanel } from './components/MachinesPanel';
import { NoSelection } from './components/NoSelection';
import { Button, Notice, Skeleton } from './components/primitives';
import { SignInPanel } from './components/SignInPanel';
import { TopBar } from './components/TopBar';
import { TranscriptionEditor } from './components/TranscriptionEditor';
import { TranscriptionList } from './components/TranscriptionList';
import { UploadPanel } from './components/UploadPanel';
import { useAuthCommand, useGoogleSignIn, useSignOut } from './hooks/use-auth';
import { useSignInOptions } from './hooks/use-sign-in-options';
import { useTranscriptionEvents, type StreamState } from './hooks/use-transcription-events';
import {
  useChangePlacement,
  useCorrectSegment,
  useRenameSpeaker,
  useRequestTranscription,
  useTranscription,
  useTranscriptionList,
} from './hooks/use-transcriptions';
import { useCreateWorkerKey, useRevokeWorkerKey, useWorkerKeys } from './hooks/use-worker-keys';
import { useTranslation, type MessageKey, type Translate } from './i18n';

const AUTH_MESSAGES: Record<AuthFailureCode, MessageKey> = {
  unreachable: 'error.authUnreachable',
  'invalid-credentials': 'error.invalidCredentials',
  'sign-up-refused': 'error.signUpRefused',
  failed: 'error.authFailed',
};

/**
 * Failures that never reached the API: nothing in them was written by a server, so the
 * interface says them in the reader's language. Anything the API did answer keeps its own
 * message — the server is the one who knows what it refused.
 */
const TRANSPORT_MESSAGES: Partial<Record<string, MessageKey>> = {
  network_unreachable: 'error.networkUnreachable',
  request_timeout: 'error.requestTimeout',
};

function describeFailure(error: unknown, t: Translate): string | null {
  if (error === null || error === undefined) return null;
  if (error instanceof AuthError) {
    return t(AUTH_MESSAGES[error.code], { min: MIN_PASSWORD_LENGTH });
  }
  if (error instanceof ApiError) {
    const known = TRANSPORT_MESSAGES[error.code];
    if (known !== undefined) return t(known);
  }
  return error instanceof Error ? error.message : t('error.unexpected');
}

type DetailBoundaryProps = { children: ReactNode; onRetry: () => void; t: Translate };

/**
 * Render guard of the transcription panel: an editor that breaks must carry away neither the
 * shell nor the library. The rest of the screen goes on serving, and the error offers a way to
 * resume instead of a blank page.
 */
class DetailBoundary extends Component<DetailBoundaryProps, { failed: boolean }> {
  constructor(props: DetailBoundaryProps) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // No third-party service here: the browser console is the only log available.
    console.error('Transcription rendering interrupted.', error, info);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    const { t } = this.props;
    return (
      <div className="panel detail-status">
        <Notice
          tone="error"
          title={t('detail.crashTitle')}
          action={
            <Button variant="secondary" onClick={this.props.onRetry}>
              {t('action.retry')}
            </Button>
          }
        >
          {t('detail.crashBody')}
        </Notice>
      </div>
    );
  }
}

/**
 * Detail of the selected transcription: query, event stream and correction. The editor itself
 * receives nothing but data and callbacks.
 */
function SelectedTranscription({
  transcriptionId,
  onReadable,
}: {
  transcriptionId: string;
  /** Called once per transcription, when there is finally something to read. */
  onReadable: () => void;
}) {
  const { t } = useTranslation();
  const [stream, setStream] = useState<StreamState>('connecting');
  // Resume token: incrementing it reopens the stream — it is the “Reconnect” button.
  const [resumeToken, setResumeToken] = useState(0);

  // Stream lost: the detail is polled periodically, for want of anything better, so that the
  // view still ends up seeing the end of the transcription.
  const detail = useTranscription(transcriptionId, { degraded: stream === 'lost' });
  const correction = useCorrectSegment(transcriptionId);
  const rename = useRenameSpeaker(transcriptionId);
  const placement = useChangePlacement(transcriptionId);
  const status = detail.data?.status;
  const readableId = detail.data?.id;

  // The loaded id no longer moves during the stream: the view therefore shifts only once, on
  // opening, and never under the eyes of someone who is correcting.
  useEffect(() => {
    if (readableId !== undefined) onReadable();
  }, [readableId]);

  useTranscriptionEvents({
    transcriptionId,
    enabled: status === 'pending' || status === 'transcribing',
    resumeToken,
    onStateChange: setStream,
  });

  if (detail.data === undefined) {
    const failure = describeFailure(detail.error, t);
    if (failure !== null) {
      return (
        <div className="panel detail-status">
          <Notice
            tone="error"
            title={t('detail.unreadableTitle')}
            action={
              <Button variant="secondary" onClick={() => void detail.refetch()}>
                {t('action.retry')}
              </Button>
            }
          >
            {failure}
          </Notice>
        </div>
      );
    }
    // The space is reserved right now: the content that lands pushes nothing.
    return (
      <div className="panel detail-status">
        <p className="detail-status__text" role="status">
          {t('detail.opening')}
        </p>
        <Skeleton lines={6} />
      </div>
    );
  }

  const savingOrdinal = correction.isPending ? (correction.variables?.ordinal ?? null) : null;
  const renamingSpeakerIndex = rename.isPending ? (rename.variables?.index ?? null) : null;

  return (
    <TranscriptionEditor
      transcription={detail.data}
      mediaUrl={transcriptionUrls.media(transcriptionId)}
      buildExportUrl={(format: SubtitleFormat) => transcriptionUrls.export(transcriptionId, format)}
      savingOrdinal={savingOrdinal}
      errorMessage={describeFailure(correction.error, t)}
      streamLost={stream === 'lost'}
      onRetryStream={() => setResumeToken((token) => token + 1)}
      onCorrectSegment={(request) => correction.mutate(request)}
      renamingSpeakerIndex={renamingSpeakerIndex}
      renameErrorMessage={describeFailure(rename.error, t)}
      onRenameSpeaker={(request) => rename.mutate(request)}
      movingToService={placement.isPending}
      placementErrorMessage={describeFailure(placement.error, t)}
      onMoveToService={() => placement.mutate('service')}
    />
  );
}

/** Workspace of a signed-in user: upload, library, editor. */
function Workspace({
  displayName,
  signingOut,
  signOutError,
  onSignOut,
}: {
  displayName: string;
  signingOut: boolean;
  signOutError: string | null;
  onSignOut: () => void;
}) {
  const { t, format } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [acceptedId, setAcceptedId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const detailRef = useRef<HTMLElement>(null);
  const library = useTranscriptionList();
  const upload = useRequestTranscription();
  const machines = useWorkerKeys();
  const createMachine = useCreateWorkerKey();
  const revokeMachine = useRevokeWorkerKey();

  /**
   * A revoked machine will serve no more: it does not count when deciding whether the user has
   * anything to arbitrate at upload time. With no live machine, the choice does not appear.
   */
  const hasLiveMachine = (machines.data ?? []).some((machine) => machine.revokedAt === null);

  // Media size rule: it belongs to the API contract, not to the form.
  const sizeError =
    file !== null && file.size > MEDIA_MAX_BYTES
      ? t('upload.tooLarge', {
          size: format.byteSize(file.size),
          max: format.byteSize(MEDIA_MAX_BYTES),
        })
      : null;

  /**
   * Opens a transcription. The movement of the view, in contrast, waits until the panel has
   * something to show: aiming during the click means aiming at a still-empty panel, and in a
   * single column the user stays in front of the list they have just left.
   */
  const openTranscription = (transcriptionId: string) => {
    setSelectedId(transcriptionId);
  };

  /**
   * The focus carries the announcement to the screen reader; `scrollIntoView` brings the top of
   * the panel, where `focus()` alone settles for the edge of the screen.
   */
  const revealDetail = useCallback(() => {
    const detail = detailRef.current;
    if (detail === null) return;
    detail.focus({ preventScroll: true });
    detail.scrollIntoView({ block: 'start' });
  }, []);

  return (
    <>
      <a className="skip-link" href="#workspace">
        {t('app.skipToContent')}
      </a>

      <TopBar
        displayName={displayName}
        signingOut={signingOut}
        signOutError={signOutError}
        onSignOut={onSignOut}
      />

      {/*
        Container query: it is the width actually available that decides between one and two
        columns, not the width of the window. Enlarged text therefore folds the workspace the
        way a narrow screen would, instead of squeezing the reading column.
      */}
      <main
        className="workspace"
        id="workspace"
        tabIndex={-1}
        aria-label={t('app.workspaceLabel')}
      >
        <div className="workspace__grid">
          <div className="workspace__aside">
            <UploadPanel
              models={WHISPER_MODELS}
              languages={TRANSCRIPTION_LANGUAGES}
              defaultModel={DEFAULT_MODEL}
              defaultLanguage={DEFAULT_LANGUAGE}
              maxByteSize={MEDIA_MAX_BYTES}
              file={file}
              sizeError={sizeError}
              submitting={upload.isPending}
              errorMessage={describeFailure(upload.error, t)}
              acceptedId={acceptedId}
              placementAvailable={hasLiveMachine}
              onFileChange={setFile}
              onSubmit={(request) =>
                upload.mutate(request, {
                  onSuccess: (accepted) => {
                    // The transcription is opened at once: its segments land there live.
                    setAcceptedId(accepted.id);
                    setFile(null);
                    openTranscription(accepted.id);
                  },
                })
              }
            />

            <TranscriptionList
              items={library.data ?? []}
              selectedId={selectedId}
              loading={library.isPending}
              errorMessage={describeFailure(library.error, t)}
              onSelect={openTranscription}
            />

            <MachinesPanel
              machines={machines.data ?? []}
              loading={machines.isPending}
              listError={describeFailure(machines.error, t)}
              origin={window.location.origin}
              creating={createMachine.isPending}
              createError={describeFailure(createMachine.error, t)}
              created={createMachine.data ?? null}
              onCreate={(request) => createMachine.mutate(request)}
              onDismissSecret={() => createMachine.reset()}
              revokingId={revokeMachine.isPending ? (revokeMachine.variables?.id ?? null) : null}
              revokeError={describeFailure(revokeMachine.error, t)}
              onRevoke={(id) => revokeMachine.mutate({ id })}
            />
          </div>

          <section
            className="workspace__detail"
            ref={detailRef}
            tabIndex={-1}
            aria-label={t('app.detailLabel')}
          >
            <DetailBoundary
              key={`${selectedId ?? 'none'}:${retryToken}`}
              onRetry={() => setRetryToken((token) => token + 1)}
              t={t}
            >
              {selectedId === null ? (
                <NoSelection />
              ) : (
                <SelectedTranscription transcriptionId={selectedId} onReadable={revealDetail} />
              )}
            </DetailBoundary>
          </section>
        </div>
      </main>
    </>
  );
}

export function App() {
  const { t } = useTranslation();
  const session = useSession();
  const authCommand = useAuthCommand();
  const googleSignIn = useGoogleSignIn();
  const signOutCommand = useSignOut();
  const signInOptions = useSignInOptions();

  if (session.isPending) {
    return (
      <main className="boot">
        <p role="status">{t('app.openingSession')}</p>
      </main>
    );
  }

  const account = session.data;
  if (account === null || account === undefined) {
    return (
      <SignInPanel
        onSubmit={(command) => authCommand.mutate(command)}
        submitting={authCommand.isPending}
        // Both routes write into the same region: two refusals are never shown at once.
        errorMessage={describeFailure(authCommand.error ?? googleSignIn.error, t)}
        minPasswordLength={MIN_PASSWORD_LENGTH}
        googleAvailable={signInOptions.data?.google === true}
        onGoogle={() => googleSignIn.mutate()}
        googleSubmitting={googleSignIn.isPending}
      />
    );
  }

  return (
    <Workspace
      displayName={account.user.name === '' ? account.user.email : account.user.name}
      signingOut={signOutCommand.isPending}
      signOutError={describeFailure(signOutCommand.error, t)}
      onSignOut={() => signOutCommand.mutate()}
    />
  );
}
