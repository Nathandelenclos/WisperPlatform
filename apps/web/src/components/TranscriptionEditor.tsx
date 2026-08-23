import { useCallback, useEffect, useRef, useState, type ReactEventHandler } from 'react';
import {
  TRANSCRIPTION_LANGUAGES,
  type Placement,
  type Segment,
  type SubtitleFormat,
  type TranscriptionStatus,
  type TranscriptionView,
} from '../api/transcriptions';
import { formatByteSize, formatDateTime, formatDuration, formatTimecode } from '../format';
import { ExportMenu } from './ExportMenu';
import { SegmentRow } from './SegmentRow';
import { SpeakerTurn } from './SpeakerTurn';
import { Button, EmptyState, Notice, Skeleton, StatusPill, VisuallyHidden } from './primitives';

/** Recommencer, ici, c'est redéposer un média : l'ancre mène au panneau de dépôt. */
const UPLOAD_ANCHOR = '#upload-panel';

/** Ce que le média a réellement à montrer, connu seulement une fois ses métadonnées lues. */
type Picture = 'unknown' | 'present' | 'absent';

/**
 * Une transcription peut durer des minutes : l'écran dit toujours où en est le travail, et
 * le nombre de segments arrivés est la seule mesure honnête de son avancement.
 */
function describeProgress(
  status: TranscriptionStatus,
  count: number,
  placement: Placement,
): string {
  const counted = `${count} ${count === 1 ? 'segment' : 'segments'}`;
  const transcribed = count === 1 ? 'transcrit' : 'transcrits';
  switch (status) {
    case 'pending':
      return placement === 'owner'
        ? "En attente de votre machine : la transcription démarrera dès qu'une des vôtres tournera."
        : "En file d'attente : la transcription démarrera dès qu'un worker sera libre.";
    case 'transcribing':
      return `${counted} ${transcribed} — la suite arrive au fil de l'eau.`;
    case 'completed':
      return `${counted}. Corrigez une ligne en cliquant dans son texte.`;
    case 'failed':
      return count === 0
        ? "L'échec est survenu avant le premier segment."
        : `${counted} ${transcribed} avant l'échec.`;
  }
}

type TranscriptionEditorProps = {
  transcription: TranscriptionView;
  mediaUrl: string;
  buildExportUrl: (format: SubtitleFormat) => string;
  /** Segment en cours d'enregistrement, s'il y en a un. */
  savingOrdinal: number | null;
  errorMessage: string | null;
  /** Le flux d'événements est coupé : la vue n'avance plus en direct. */
  streamLost: boolean;
  onRetryStream: () => void;
  onCorrectSegment: (correction: { ordinal: number; text: string }) => void;
  /** Locuteur en cours de renommage, s'il y en a un. */
  renamingSpeakerIndex: number | null;
  renameErrorMessage: string | null;
  onRenameSpeaker: (rename: { index: number; name: string }) => void;
  /** Bascule de placement en cours : le geste de reprise en main est occupé. */
  movingToService: boolean;
  placementErrorMessage: string | null;
  onMoveToService: () => void;
};

/**
 * Lecture du média et correction des segments. L'état de lecture (segment courant, position,
 * suivi du défilement) est purement visuel et reste ici ; les corrections partent en callback.
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
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);
  // Dernière position connue, en millisecondes : elle survit à la bascule vidéo → audio.
  const positionRef = useRef(0);
  // Segment surligné, gardé aussi en ref pour trancher un `timeupdate` sans re-rendre.
  const heldRef = useRef<Segment | null>(null);

  const [currentOrdinal, setCurrentOrdinal] = useState<number | null>(null);
  const [fieldFocused, setFieldFocused] = useState(false);
  const [follow, setFollow] = useState(false);
  const [picture, setPicture] = useState<Picture>('unknown');
  const [announcement, setAnnouncement] = useState<{ token: number; text: string } | null>(null);
  // Tour de parole dont le formulaire de renommage est ouvert, désigné par l'ordinal du
  // segment qui l'ouvre : un locuteur peut avoir vingt tours, un seul champ à la fois.
  const [openTurn, setOpenTurn] = useState<number | null>(null);

  const { segments, speakers, status, placement } = transcription;
  const isVideo = transcription.mediaContentType.startsWith('video/');
  // Un conteneur vidéo peut n'avoir aucune image exploitable — un `.mov` enregistré au micro,
  // par exemple. Afficher un rectangle noir mentirait sur ce que contient le fichier.
  const soundOnly = isVideo && picture === 'absent';
  // Le domaine ne corrige un segment que sur une transcription terminée.
  const editable = status === 'completed';
  // Une reprise vide la liste : le champ qui avait le focus a disparu avec elle, et le
  // navigateur ne garantit pas de `blur` sur un élément retiré. Sans ce garde-fou, le
  // réglage de suivi resterait désactivé pour de bon.
  const editing = fieldFocused && segments.length > 0;

  const languageLabel =
    TRANSCRIPTION_LANGUAGES.find((candidate) => candidate.value === transcription.language)
      ?.label ?? transcription.language;
  const spokenMs = segments.at(-1)?.endMs ?? null;
  // Une demande réservée aux machines du propriétaire et qui n'a pas démarré : c'est le
  // seul cas où il a une décision à reprendre, et il doit pouvoir la reprendre à la main.
  const stuckOnOwnMachine = status === 'pending' && placement === 'owner';

  /** Une région live ne se répète pas d'elle-même : le jeton force la relecture. */
  const announce = useCallback((text: string) => {
    setAnnouncement((current) => ({ token: (current?.token ?? 0) + 1, text }));
  }, []);

  // Identité stable : un ref-callback recréé à chaque rendu serait détaché/rattaché.
  const attachMedia = useCallback((node: HTMLMediaElement | null) => {
    mediaRef.current = node;
    // Report de la tête de lecture quand l'élément change de nature (vidéo → audio).
    if (node !== null && positionRef.current > 0) node.currentTime = positionRef.current / 1000;
  }, []);

  const followPlayback = () => {
    const media = mediaRef.current;
    if (media === null) return;
    const positionMs = media.currentTime * 1000;
    positionRef.current = positionMs;

    // Cas courant, quatre fois par seconde : la lecture avance dans le segment déjà
    // surligné. Rien à chercher, rien à re-rendre — un transcript peut compter des
    // milliers de lignes et n'a aucune raison de se redessiner à chaque battement.
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
      // Lecture refusée par le navigateur : le déplacement de la tête de lecture suffit.
    });
  };

  // Une seule référence pour toute la liste : l'ordinal remonte en argument plutôt que
  // d'être capturé dans une fermeture par ligne.
  const commitSegment = (ordinal: number, text: string) => onCorrectSegment({ ordinal, text });

  // Suivi de la lecture : jamais pendant une correction, et `nearest` ne déplace rien tant
  // que le segment lu est déjà à l'écran. Aucun `behavior` demandé : le défilement suit la
  // préférence de mouvement du système, réglée dans le socle.
  useEffect(() => {
    if (!follow || editing || currentOrdinal === null) return;
    listRef.current
      ?.querySelector(`[data-ordinal="${currentOrdinal}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [follow, editing, currentOrdinal]);

  // Le sort d'une correction est annoncé, pas seulement coloré : la fin de l'enregistrement
  // se lit à la disparition de `savingOrdinal`, et l'erreur éventuelle l'accompagne.
  const previousSaving = useRef<number | null>(null);
  useEffect(() => {
    const previous = previousSaving.current;
    previousSaving.current = savingOrdinal;
    if (previous === null || previous === savingOrdinal) return;
    const saved = segments.find((segment) => segment.ordinal === previous);
    const where = saved === undefined ? '' : ` à ${formatTimecode(saved.startMs)}`;
    announce(
      errorMessage === null
        ? `Segment${where} enregistré.`
        : `Segment${where} non enregistré : ${errorMessage}`,
    );
  }, [savingOrdinal, errorMessage, segments, announce]);

  // Le sort d'un renommage s'entend aussi. La fin de l'envoi se lit à la disparition de
  // `renamingSpeakerIndex` ; le formulaire ne se referme que si le serveur a accepté, sinon
  // la correction se rejoue là où elle a été saisie.
  const previousRenaming = useRef<number | null>(null);
  useEffect(() => {
    const previous = previousRenaming.current;
    previousRenaming.current = renamingSpeakerIndex;
    if (previous === null || previous === renamingSpeakerIndex) return;
    if (renameErrorMessage !== null) {
      announce(`Locuteur non renommé : ${renameErrorMessage}`);
      return;
    }
    setOpenTurn(null);
    const renamed = speakers.find((speaker) => speaker.index === previous)?.name ?? null;
    announce(
      renamed === null
        ? 'Locuteur renommé dans toute la transcription.'
        : `Locuteur renommé en ${renamed} dans toute la transcription.`,
    );
  }, [renamingSpeakerIndex, renameErrorMessage, speakers, announce]);

  // Un flux perdu se voit — et s'entend : le bandeau ne suffit pas à qui ne le voit pas.
  const previousLost = useRef(streamLost);
  useEffect(() => {
    if (previousLost.current === streamLost) return;
    previousLost.current = streamLost;
    announce(
      streamLost
        ? "Connexion au direct perdue : les segments n'arrivent plus au fil de l'eau."
        : 'Connexion au direct rétablie.',
    );
  }, [streamLost, announce]);

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
            <dt>Modèle</dt>
            <dd>{transcription.model}</dd>
          </div>
          <div className="transcript__fact">
            <dt>Langue</dt>
            <dd>{languageLabel}</dd>
          </div>
          <div className="transcript__fact">
            <dt>Média</dt>
            <dd>{formatByteSize(transcription.mediaByteSize)}</dd>
          </div>
          <div className="transcript__fact">
            <dt>Déposé</dt>
            <dd>{formatDateTime(transcription.requestedAt)}</dd>
          </div>
          {/* Fait montré seulement s'il sort de l'ordinaire : « service » est le défaut. */}
          {placement === 'owner' ? (
            <div className="transcript__fact">
              <dt>Calcul</dt>
              <dd>Votre machine</dd>
            </div>
          ) : null}
          {spokenMs === null ? null : (
            <div className="transcript__fact">
              <dt>Parole</dt>
              <dd>{formatDuration(spokenMs)}</dd>
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
        {soundOnly ? (
          <p className="media-player__note">
            Ce fichier ne contient pas d'image exploitable : seule sa bande son est lue.
          </p>
        ) : null}
      </div>

      {status === 'failed' ? (
        <Notice
          tone="error"
          title="La transcription a échoué"
          action={
            <a className="transcript__action" href={UPLOAD_ANCHOR}>
              Déposer à nouveau
            </a>
          }
        >
          {transcription.failureReason === null
            ? "Le worker n'a transmis aucune raison. Un nouveau dépôt du média relance une tentative."
            : transcription.failureReason}
        </Notice>
      ) : null}

      {/*
        Réservée aux machines du propriétaire : elle peut attendre indéfiniment, et rien ne
        la déplacera tout seul. L'écran dit l'attente réelle et offre la seule sortie qui
        existe — confier le calcul au service. La décision reste la sienne.
      */}
      {stuckOnOwnMachine ? (
        <Notice
          tone="info"
          title="En attente de votre machine"
          action={
            <Button
              variant="secondary"
              size="sm"
              loading={movingToService}
              onClick={onMoveToService}
            >
              Confier au service
            </Button>
          }
        >
          Cette transcription est réservée à vos machines : elle démarrera dès que l'une
          d'elles tournera, et attendra aussi longtemps qu'il le faudra.
        </Notice>
      ) : null}

      {placementErrorMessage === null ? null : (
        <Notice tone="error" title="Transcription non déplacée">
          {placementErrorMessage}
        </Notice>
      )}

      {errorMessage === null ? null : <Notice tone="error">{errorMessage}</Notice>}

      {streamLost ? (
        <Notice
          tone="warning"
          title="Direct interrompu"
          action={
            <Button variant="secondary" size="sm" onClick={onRetryStream}>
              Reconnecter
            </Button>
          }
        >
          Les segments n'arrivent plus au fil de l'eau. La vue est rafraîchie toutes les
          quelques secondes en attendant.
        </Notice>
      ) : null}

      {(status === 'pending' || status === 'transcribing') && segments.length > 0 ? (
        <Notice tone="info">
          Texte en lecture seule : la correction s'ouvre une fois la transcription terminée.
        </Notice>
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
            <span>Suivre la lecture</span>
          </label>
          <p className="transcript__hint" id="follow-hint">
            Le transcript défile jusqu'au segment lu. Le suivi se suspend tant que le curseur
            est posé dans un texte : rien ne bouge sous le curseur.
          </p>
        </div>

        {segments.length > 0 ? <ExportMenu buildUrl={buildExportUrl} /> : null}
      </div>

      <p className="transcript__progress" role="status">
        {describeProgress(status, segments.length, placement)}
      </p>

      {segments.length === 0 && status === 'completed' ? (
        <EmptyState
          title="Aucune parole détectée"
          description="Le média a bien été analysé, mais aucune parole exploitable n'y a été trouvée. Un autre fichier, ou un modèle plus grand, donnera peut-être un meilleur résultat."
          action={
            <a className="transcript__action" href={UPLOAD_ANCHOR}>
              Déposer un autre média
            </a>
          }
        />
      ) : null}

      {segments.length > 0 || status === 'transcribing' ? (
        <ol className="transcript__segments" ref={listRef}>
          {segments.map((segment, position) => {
            // Étiquette de locuteur au seul CHANGEMENT de tour : une conversation se lit en
            // tours de parole, et le même nom répété à chaque ligne n'est que du bruit.
            // Un index absent du modèle de lecture garde son rang pour nom : mieux vaut un
            // tour nommé par défaut qu'un tour effacé.
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
            // Ligne fantôme : la place du segment suivant est réservée en bas de liste, là
            // où rien de déjà lu ne peut être décalé. Muette pour l'assistance — la ligne
            // d'avancement dit déjà que le travail continue.
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
