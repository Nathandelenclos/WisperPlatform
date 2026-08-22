import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
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
import { MIN_PASSWORD_LENGTH } from './auth/session';
import { NoSelection } from './components/NoSelection';
import { Button, Notice, Skeleton } from './components/primitives';
import { SignInPanel } from './components/SignInPanel';
import { TopBar } from './components/TopBar';
import { TranscriptionEditor } from './components/TranscriptionEditor';
import { TranscriptionList } from './components/TranscriptionList';
import { UploadPanel } from './components/UploadPanel';
import { formatByteSize } from './format';
import { useAuthCommand, useSignOut } from './hooks/use-auth';
import { useTranscriptionEvents, type StreamState } from './hooks/use-transcription-events';
import {
  useCorrectSegment,
  useRenameSpeaker,
  useRequestTranscription,
  useTranscription,
  useTranscriptionList,
} from './hooks/use-transcriptions';

function describeFailure(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  return error instanceof Error ? error.message : 'Une erreur inattendue est survenue.';
}

type DetailBoundaryProps = { children: ReactNode; onRetry: () => void };

/**
 * Garde-fou de rendu du panneau de transcription : un éditeur qui casse ne doit emporter
 * ni la coquille ni la bibliothèque. Le reste de l'écran continue de servir, et l'erreur
 * propose une reprise au lieu d'un écran blanc.
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
    // Pas de service tiers ici : la console du navigateur est le seul journal disponible.
    console.error('Rendu de la transcription interrompu.', error, info);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="panel detail-status">
        <Notice
          tone="error"
          title="Affichage interrompu"
          action={
            <Button variant="secondary" onClick={this.props.onRetry}>
              Réessayer
            </Button>
          }
        >
          Cette transcription n'a pas pu s'afficher. Réessayez, ou ouvrez-en une autre depuis la
          bibliothèque.
        </Notice>
      </div>
    );
  }
}

/**
 * Détail de la transcription sélectionnée : requête, flux d'événements et correction.
 * L'éditeur, lui, ne reçoit que des données et des callbacks.
 */
function SelectedTranscription({
  transcriptionId,
  onReadable,
}: {
  transcriptionId: string;
  /** Appelé une fois par transcription, quand il y a enfin quelque chose à lire. */
  onReadable: () => void;
}) {
  const [stream, setStream] = useState<StreamState>('connecting');
  // Jeton de reprise : l'incrémenter rouvre le flux, c'est le bouton « Reconnecter ».
  const [resumeToken, setResumeToken] = useState(0);

  // Flux perdu : le détail est rappelé périodiquement, faute de mieux, pour que la vue
  // finisse quand même par voir la fin de la transcription.
  const detail = useTranscription(transcriptionId, { degraded: stream === 'lost' });
  const correction = useCorrectSegment(transcriptionId);
  const rename = useRenameSpeaker(transcriptionId);
  const status = detail.data?.status;
  const readableId = detail.data?.id;

  // L'identifiant chargé ne bouge plus pendant le flux : la vue ne se déplace donc qu'une
  // fois, à l'ouverture, et jamais sous les yeux de quelqu'un qui corrige.
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
    const failure = describeFailure(detail.error);
    if (failure !== null) {
      return (
        <div className="panel detail-status">
          <Notice
            tone="error"
            title="Transcription illisible"
            action={
              <Button variant="secondary" onClick={() => void detail.refetch()}>
                Réessayer
              </Button>
            }
          >
            {failure}
          </Notice>
        </div>
      );
    }
    // La place est réservée dès maintenant : le contenu qui arrive ne pousse rien.
    return (
      <div className="panel detail-status">
        <p className="detail-status__text" role="status">
          Ouverture de la transcription…
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
      errorMessage={describeFailure(correction.error)}
      streamLost={stream === 'lost'}
      onRetryStream={() => setResumeToken((token) => token + 1)}
      onCorrectSegment={(request) => correction.mutate(request)}
      renamingSpeakerIndex={renamingSpeakerIndex}
      renameErrorMessage={describeFailure(rename.error)}
      onRenameSpeaker={(request) => rename.mutate(request)}
    />
  );
}

/** Espace de travail d'un utilisateur connecté : dépôt, bibliothèque, éditeur. */
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [acceptedId, setAcceptedId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const detailRef = useRef<HTMLElement>(null);
  const library = useTranscriptionList();
  const upload = useRequestTranscription();

  // Règle de taille du média : elle appartient au contrat de l'API, pas au formulaire.
  const sizeError =
    file !== null && file.size > MEDIA_MAX_BYTES
      ? `Fichier trop volumineux : ${formatByteSize(file.size)} pour ${formatByteSize(MEDIA_MAX_BYTES)} autorisés.`
      : null;

  /**
   * Ouvre une transcription. Le déplacement de la vue, lui, attend que le panneau ait
   * quelque chose à montrer : viser pendant le clic, c'est viser un panneau encore vide,
   * et sur une colonne unique l'utilisateur reste devant la liste qu'il vient de quitter.
   */
  const openTranscription = (transcriptionId: string) => {
    setSelectedId(transcriptionId);
  };

  /**
   * Le focus porte l'annonce au lecteur d'écran ; `scrollIntoView` amène le haut du
   * panneau, là où `focus()` seul se contente du bord de l'écran.
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
        Aller au contenu principal
      </a>

      <TopBar
        displayName={displayName}
        signingOut={signingOut}
        signOutError={signOutError}
        onSignOut={onSignOut}
      />

      {/*
        Conteneur de requête : c'est la largeur réellement disponible qui décide d'une ou
        de deux colonnes, pas celle de la fenêtre. Un texte agrandi replie donc l'atelier
        comme le ferait un écran étroit, au lieu de comprimer la colonne de lecture.
      */}
      <main
        className="workspace"
        id="workspace"
        tabIndex={-1}
        aria-label="Atelier de transcription"
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
              errorMessage={describeFailure(upload.error)}
              acceptedId={acceptedId}
              onFileChange={setFile}
              onSubmit={(request) =>
                upload.mutate(request, {
                  onSuccess: (accepted) => {
                    // On ouvre aussitôt la transcription : les segments y arrivent en direct.
                    setAcceptedId(accepted.id);
                    setFile(null);
                    openTranscription(accepted.id);
                  },
                })
              }
            />

            <TranscriptionList
              items={library.data ?? []}
              languages={TRANSCRIPTION_LANGUAGES}
              selectedId={selectedId}
              loading={library.isPending}
              errorMessage={describeFailure(library.error)}
              onSelect={openTranscription}
            />
          </div>

          <section
            className="workspace__detail"
            ref={detailRef}
            tabIndex={-1}
            aria-label="Transcription ouverte"
          >
            <DetailBoundary
              key={`${selectedId ?? 'none'}:${retryToken}`}
              onRetry={() => setRetryToken((token) => token + 1)}
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
  const session = useSession();
  const authCommand = useAuthCommand();
  const signOutCommand = useSignOut();

  if (session.isPending) {
    return (
      <main className="boot">
        <p role="status">Ouverture de votre session…</p>
      </main>
    );
  }

  const account = session.data;
  if (account === null || account === undefined) {
    return (
      <SignInPanel
        onSubmit={(command) => authCommand.mutate(command)}
        submitting={authCommand.isPending}
        errorMessage={describeFailure(authCommand.error)}
        minPasswordLength={MIN_PASSWORD_LENGTH}
      />
    );
  }

  return (
    <Workspace
      displayName={account.user.name === '' ? account.user.email : account.user.name}
      signingOut={signOutCommand.isPending}
      signOutError={describeFailure(signOutCommand.error)}
      onSignOut={() => signOutCommand.mutate()}
    />
  );
}
