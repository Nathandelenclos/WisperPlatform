import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import {
  WORKER_KEY_LABEL_MAX,
  workerRunCommand,
  type CreatedWorkerKey,
  type WorkerKey,
} from '../api/worker-keys';
import { formatRelativeTime } from '../format';
import { Button, EmptyState, Field, Notice, Skeleton, TextInput } from './primitives';

/** Le retour de copie s'efface : c'est un accusé de réception, pas un état de l'écran. */
const COPY_FEEDBACK_MS = 5_000;

const COPY_FAILED_MESSAGE =
  "Copie refusée par le navigateur. Sélectionnez le texte et copiez-le à la main.";

type CopyState = { token: number; ok: boolean };

/**
 * Copie en un geste. La valeur ne transite ni par une URL, ni par un attribut, ni par la
 * console : elle part directement dans le presse-papiers, et un refus se dit au lieu de
 * laisser croire que la copie a eu lieu.
 */
function CopyButton({
  value,
  label,
  copiedMessage,
}: {
  value: string;
  label: string;
  copiedMessage: string;
}): ReactElement {
  // Le jeton force la relecture par le lecteur d'écran : deux copies de suite produisent
  // le même texte, et une région live ne répète pas d'elle-même.
  const [state, setState] = useState<CopyState | null>(null);

  useEffect(() => {
    if (state === null) return;
    const timer = setTimeout(() => setState(null), COPY_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = async (): Promise<void> => {
    let ok = true;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Contexte non sécurisé ou permission refusée. Rien à journaliser : le message
      // porterait le secret dans la console.
      ok = false;
    }
    setState((current) => ({ token: (current?.token ?? 0) + 1, ok }));
  };

  return (
    <div className="machines__copy-control">
      <Button variant="secondary" size="sm" onClick={() => void copy()}>
        {label}
      </Button>
      <span className="machines__copy-status" role="status">
        {state === null ? null : (
          <span key={state.token} className={state.ok ? undefined : 'machines__copy-failed'}>
            {state.ok ? copiedMessage : COPY_FAILED_MESSAGE}
          </span>
        )}
      </span>
    </div>
  );
}

/** Ce que `lastSeenAt` veut dire pour quelqu'un qui se demande si sa machine tourne. */
function LastSeen({ machine }: { machine: WorkerKey }): ReactElement {
  if (machine.revokedAt !== null) {
    return (
      <p className="machines__seen">
        Révoquée <time dateTime={machine.revokedAt}>{formatRelativeTime(machine.revokedAt)}</time>.
        Le worker qui la porte est refusé.
      </p>
    );
  }
  if (machine.lastSeenAt === null) {
    return (
      <p className="machines__seen">
        Jamais vue : aucun worker ne s'est encore présenté avec cette clé.
      </p>
    );
  }
  return (
    <p className="machines__seen">
      Vue <time dateTime={machine.lastSeenAt}>{formatRelativeTime(machine.lastSeenAt)}</time>.
    </p>
  );
}

type MachinesPanelProps = {
  machines: readonly WorkerKey[];
  loading: boolean;
  listError: string | null;
  /** Origine de la page : le worker doit joindre la même API que le navigateur. */
  origin: string;
  creating: boolean;
  createError: string | null;
  /** Clé qui vient d'être créée, secret compris. `null` dès qu'elle a été acquittée. */
  created: CreatedWorkerKey | null;
  onCreate: (request: { label: string }) => void;
  onDismissSecret: () => void;
  revokingId: string | null;
  revokeError: string | null;
  onRevoke: (id: string) => void;
};

/**
 * Machines de l'utilisateur : en déclarer une, voir si elles tournent, en révoquer une.
 *
 * La clé secrète n'est montrée qu'une fois, et l'écran le dit **avant** de la produire :
 * découvrir après coup qu'on avait une seule occasion de la copier est une impasse.
 */
export function MachinesPanel({
  machines,
  loading,
  listError,
  origin,
  creating,
  createError,
  created,
  onCreate,
  onDismissSecret,
  revokingId,
  revokeError,
  onRevoke,
}: MachinesPanelProps) {
  const [label, setLabel] = useState('');
  // Machine dont la demande de révocation est dépliée : un seul avertissement à la fois.
  const [confirming, setConfirming] = useState<string | null>(null);
  /**
   * La carte du secret disparaît avec le bouton qui la ferme : sans reprise explicite, le
   * focus retombe sur le corps du document et le clavier repart du haut de la page. Le
   * formulaire remonte à cet instant précis, c'est donc son montage qui reprend le focus —
   * une intention, pas un état : elle ne vaut que pour le prochain montage.
   */
  const refocusForm = useRef(false);

  // Identité stable : chaque cible n'est visée qu'à son montage, jamais à chaque rendu —
  // sinon le focus reviendrait s'y poser pendant qu'on tape ailleurs.
  const focusOnMount = useCallback((node: HTMLElement | null) => {
    node?.focus();
  }, []);

  const attachForm = useCallback((node: HTMLFormElement | null) => {
    if (node === null || !refocusForm.current) return;
    refocusForm.current = false;
    node.focus();
  }, []);

  /**
   * Une révocation acceptée retire le bouton qui l'a déclenchée : sans reprise, le focus
   * retombe sur le corps du document. Il se pose sur la ligne, qui porte désormais l'état
   * révoqué — le lecteur d'écran annonce donc le résultat du geste. La fin de l'envoi se
   * lit à la disparition de `revokingId` ; un refus, lui, laisse le bouton en place.
   */
  const listRef = useRef<HTMLUListElement>(null);
  const previousRevoking = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousRevoking.current;
    previousRevoking.current = revokingId;
    if (previous === null || previous === revokingId || revokeError !== null) return;
    setConfirming(null);
    listRef.current?.querySelector<HTMLElement>(`[data-machine="${previous}"]`)?.focus();
  }, [revokingId, revokeError]);

  const firstLoad = loading && machines.length === 0;
  const empty = !loading && machines.length === 0 && listError === null && created === null;
  const trimmed = label.trim();

  return (
    <section className="machines panel" aria-labelledby="machines-title">
      <div className="machines__head">
        <h2 className="machines__title" id="machines-title">
          Mes machines
        </h2>
        {machines.length === 0 ? null : (
          <span className="machines__count">{machines.length}</span>
        )}
      </div>

      <p className="machines__lede">
        Une machine à vous peut transcrire vos médias à la place des serveurs du service.
        Déclarez-la ici, puis lancez le worker avec la clé obtenue.
      </p>

      {/*
        Région live rendue en permanence et vide au repos : une région créée en même temps
        que son contenu n'est pas annoncée. Les trois refus possibles y passent tour à tour.
      */}
      <div className="machines__feedback" aria-live="polite">
        {listError !== null ? (
          <Notice tone="error" title="Machines indisponibles">
            {listError}
          </Notice>
        ) : createError !== null ? (
          <Notice tone="error" title="Machine non déclarée">
            {createError}
          </Notice>
        ) : revokeError !== null ? (
          <Notice tone="error" title="Révocation refusée">
            {revokeError}
          </Notice>
        ) : null}
      </div>

      {created === null ? (
        <form
          className="machines__form"
          ref={attachForm}
          tabIndex={-1}
          aria-label="Déclarer une machine"
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault();
            // Le champ n'est PAS vidé ici : un refus du serveur ne doit pas emporter ce
            // qui vient d'être tapé. Il se vide à l'acquittement de la clé produite.
            if (trimmed === '' || creating) return;
            onCreate({ label: trimmed });
          }}
        >
          <Field
            id="machine-label"
            label="Nom de la machine"
            hint="Pour vous y retrouver : « portable », « tour du bureau ». La clé secrète s'affichera une seule fois, juste après la création."
          >
            {(fieldProps) => (
              <TextInput
                {...fieldProps}
                name="label"
                value={label}
                maxLength={WORKER_KEY_LABEL_MAX}
                autoComplete="off"
                disabled={creating}
                onChange={(changeEvent) => setLabel(changeEvent.target.value)}
              />
            )}
          </Field>

          <Button type="submit" loading={creating} disabled={trimmed === ''}>
            {creating ? 'Création de la clé…' : 'Déclarer une machine'}
          </Button>
        </form>
      ) : (
        /*
          Le focus se pose ici dès l'apparition : la clé ne s'affiche qu'une fois, et son
          avertissement doit être lu avant tout le reste. La région porte son nom et sa mise
          en garde, le lecteur d'écran les annonce ensemble.
        */
        <section
          className="machines__secret"
          ref={focusOnMount}
          tabIndex={-1}
          aria-labelledby="machine-secret-title"
          aria-describedby="machine-secret-warning"
        >
          <p className="machines__secret-title" id="machine-secret-title">
            Clé de « {created.label} »
          </p>
          <p className="machines__secret-warning" id="machine-secret-warning">
            Cette clé ne sera plus jamais affichée : la plateforme n'en garde qu'une
            empreinte. Copiez-la maintenant.
          </p>

          <div className="machines__copy">
            <code className="machines__value">{created.secret}</code>
            <CopyButton
              value={created.secret}
              label="Copier la clé"
              copiedMessage="Clé copiée."
            />
          </div>

          <p className="machines__secret-step">Commande de lancement, clé comprise :</p>
          <div className="machines__copy">
            <code className="machines__value machines__value--command">
              {workerRunCommand({ origin, secret: created.secret })}
            </code>
            <CopyButton
              value={workerRunCommand({ origin, secret: created.secret })}
              label="Copier la commande"
              copiedMessage="Commande copiée."
            />
          </div>

          <Button
            variant="secondary"
            onClick={() => {
              onDismissSecret();
              setLabel('');
              refocusForm.current = true;
            }}
          >
            J'ai copié la clé
          </Button>
        </section>
      )}

      {/* La place est réservée dès le premier rendu : la liste qui arrive ne pousse rien. */}
      {firstLoad ? (
        <div className="machines__items" aria-hidden="true">
          <Skeleton lines={2} />
        </div>
      ) : null}

      {empty ? (
        <EmptyState
          title="Aucune machine déclarée"
          description="Vos transcriptions partent sur les serveurs du service. Déclarez une machine pour pouvoir les calculer chez vous."
        />
      ) : null}

      {machines.length === 0 ? null : (
        <ul className="machines__items" ref={listRef}>
          {machines.map((machine) => {
            const revoked = machine.revokedAt !== null;
            const open = confirming === machine.id;

            return (
              <li
                key={machine.id}
                data-machine={machine.id}
                tabIndex={-1}
                className={revoked ? 'machines__item machines__item--revoked' : 'machines__item'}
              >
                <div className="machines__item-head">
                  <span className="machines__label">{machine.label}</span>
                  {revoked ? <span className="machines__badge">Révoquée</span> : null}
                </div>

                <LastSeen machine={machine} />

                {revoked ? null : (
                  <div className="machines__actions">
                    {/*
                      Révoquer est définitif : le geste se confirme. Le déclencheur reste en
                      place et devient « Annuler », donc le focus ne saute nulle part.
                    */}
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-expanded={open}
                      onClick={() => setConfirming(open ? null : machine.id)}
                    >
                      {open ? 'Annuler' : 'Révoquer…'}
                    </Button>

                    {open ? (
                      <div className="machines__confirm">
                        <p className="machines__confirm-text">
                          Le worker qui porte cette clé sera refusé dès son prochain appel.
                          C'est définitif : il faudra déclarer une nouvelle machine.
                        </p>
                        <Button
                          variant="danger"
                          size="sm"
                          loading={revokingId === machine.id}
                          onClick={() => onRevoke(machine.id)}
                        >
                          Révoquer « {machine.label} »
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
