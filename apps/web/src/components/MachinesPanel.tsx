import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import {
  WORKER_KEY_LABEL_MAX,
  workerRunCommand,
  type CreatedWorkerKey,
  type WorkerKey,
} from '../api/worker-keys';
import { useTranslation } from '../i18n';
import { Button, EmptyState, Field, Notice, Skeleton, TextInput } from './primitives';

/** The copy feedback fades: it is an acknowledgement, not a state of the screen. */
const COPY_FEEDBACK_MS = 5_000;

type CopyState = { token: number; ok: boolean };

/**
 * Copy in one gesture. The value goes through neither a URL, nor an attribute, nor the console:
 * it goes straight to the clipboard, and a refusal is said instead of letting one believe the
 * copy happened.
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
  const { t } = useTranslation();
  // The token forces the screen reader to read again: two copies in a row produce the same
  // text, and a live region does not repeat itself.
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
      // Insecure context or permission denied. Nothing to log: the message would carry the
      // secret into the console.
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
            {state.ok ? copiedMessage : t('machines.copyFailed')}
          </span>
        )}
      </span>
    </div>
  );
}

/** What `lastSeenAt` means to someone wondering whether their machine is running. */
function LastSeen({ machine }: { machine: WorkerKey }): ReactElement {
  const { t, format } = useTranslation();

  if (machine.revokedAt !== null) {
    return (
      <p className="machines__seen">
        {t('machines.revokedOn')}{' '}
        <time dateTime={machine.revokedAt}>{format.relativeTime(machine.revokedAt)}</time>.{' '}
        {t('machines.revokedNote')}
      </p>
    );
  }
  if (machine.lastSeenAt === null) {
    return <p className="machines__seen">{t('machines.neverSeen')}</p>;
  }
  return (
    <p className="machines__seen">
      {t('machines.seenOn')}{' '}
      <time dateTime={machine.lastSeenAt}>{format.relativeTime(machine.lastSeenAt)}</time>.
    </p>
  );
}

type MachinesPanelProps = {
  machines: readonly WorkerKey[];
  loading: boolean;
  listError: string | null;
  /** Origin of the page: the worker must reach the same API as the browser. */
  origin: string;
  creating: boolean;
  createError: string | null;
  /** Key that has just been created, secret included. `null` as soon as it is acknowledged. */
  created: CreatedWorkerKey | null;
  onCreate: (request: { label: string }) => void;
  onDismissSecret: () => void;
  revokingId: string | null;
  revokeError: string | null;
  onRevoke: (id: string) => void;
};

/**
 * Machines of the user: declare one, see whether they are running, revoke one.
 *
 * The secret key is shown only once, and the screen says so **before** producing it: finding
 * out afterwards that there was a single chance to copy it is a dead end.
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
  const { t, format } = useTranslation();
  const [label, setLabel] = useState('');
  // Machine whose revocation request is unfolded: one warning at a time.
  const [confirming, setConfirming] = useState<string | null>(null);
  /**
   * The secret card disappears along with the button that closes it: without an explicit
   * recovery, the focus falls back on the document body and the keyboard starts again from the
   * top of the page. The form comes back at that precise instant, so it is its mounting that
   * takes the focus back — an intention, not a state: it only holds for the next mount.
   */
  const refocusForm = useRef(false);

  // Stable identity: each target is aimed at on its mount only, never on every render —
  // otherwise the focus would come back and land on it while one is typing elsewhere.
  const focusOnMount = useCallback((node: HTMLElement | null) => {
    node?.focus();
  }, []);

  const attachForm = useCallback((node: HTMLFormElement | null) => {
    if (node === null || !refocusForm.current) return;
    refocusForm.current = false;
    node.focus();
  }, []);

  /**
   * An accepted revocation removes the button that triggered it: without a recovery, the focus
   * falls back on the document body. It lands on the row, which now carries the revoked state
   * — so the screen reader announces the result of the gesture. The end of the submission is
   * read from the disappearance of `revokingId`; a refusal, in contrast, leaves the button in
   * place.
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
          {t('machines.title')}
        </h2>
        {machines.length === 0 ? null : (
          <span className="machines__count">{format.number(machines.length)}</span>
        )}
      </div>

      <p className="machines__lede">{t('machines.lede')}</p>

      {/*
        Live region rendered permanently and empty at rest: a region created at the same time
        as its content is not announced. The three possible refusals take turns in it.
      */}
      <div className="machines__feedback" aria-live="polite">
        {listError !== null ? (
          <Notice tone="error" title={t('machines.unavailableTitle')}>
            {listError}
          </Notice>
        ) : createError !== null ? (
          <Notice tone="error" title={t('machines.notDeclaredTitle')}>
            {createError}
          </Notice>
        ) : revokeError !== null ? (
          <Notice tone="error" title={t('machines.revokeRefusedTitle')}>
            {revokeError}
          </Notice>
        ) : null}
      </div>

      {created === null ? (
        <form
          className="machines__form"
          ref={attachForm}
          tabIndex={-1}
          aria-label={t('machines.formLabel')}
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault();
            // The field is NOT cleared here: a refusal from the server must not carry away
            // what was just typed. It clears when the produced key is acknowledged.
            if (trimmed === '' || creating) return;
            onCreate({ label: trimmed });
          }}
        >
          <Field id="machine-label" label={t('machines.labelField')} hint={t('machines.labelHint')}>
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
            {creating ? t('machines.creating') : t('machines.declare')}
          </Button>
        </form>
      ) : (
        /*
          The focus lands here as soon as it appears: the key is shown only once, and its
          warning must be read before anything else. The region carries its name and its
          caution, and the screen reader announces them together.
        */
        <section
          className="machines__secret"
          ref={focusOnMount}
          tabIndex={-1}
          aria-labelledby="machine-secret-title"
          aria-describedby="machine-secret-warning"
        >
          <p className="machines__secret-title" id="machine-secret-title">
            {t('machines.secretTitle', { label: created.label })}
          </p>
          <p className="machines__secret-warning" id="machine-secret-warning">
            {t('machines.secretWarning')}
          </p>

          <div className="machines__copy">
            <code className="machines__value">{created.secret}</code>
            <CopyButton
              value={created.secret}
              label={t('machines.copyKey')}
              copiedMessage={t('machines.keyCopied')}
            />
          </div>

          <p className="machines__secret-step">{t('machines.commandStep')}</p>
          <div className="machines__copy">
            <code className="machines__value machines__value--command">
              {workerRunCommand({ origin, secret: created.secret })}
            </code>
            <CopyButton
              value={workerRunCommand({ origin, secret: created.secret })}
              label={t('machines.copyCommand')}
              copiedMessage={t('machines.commandCopied')}
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
            {t('machines.secretAcknowledged')}
          </Button>
        </section>
      )}

      {/* The space is reserved from the first render: the list that lands pushes nothing. */}
      {firstLoad ? (
        <div className="machines__items" aria-hidden="true">
          <Skeleton lines={2} />
        </div>
      ) : null}

      {empty ? (
        <EmptyState title={t('machines.emptyTitle')} description={t('machines.emptyDescription')} />
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
                  {revoked ? (
                    <span className="machines__badge">{t('machines.revokedBadge')}</span>
                  ) : null}
                </div>

                <LastSeen machine={machine} />

                {revoked ? null : (
                  <div className="machines__actions">
                    {/*
                      Revoking is definitive: the gesture is confirmed. The trigger stays in
                      place and becomes “Cancel”, so the focus jumps nowhere.
                    */}
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-expanded={open}
                      onClick={() => setConfirming(open ? null : machine.id)}
                    >
                      {open ? t('machines.revokeCancel') : t('machines.revokeOpen')}
                    </Button>

                    {open ? (
                      <div className="machines__confirm">
                        <p className="machines__confirm-text">{t('machines.revokeWarning')}</p>
                        <Button
                          variant="danger"
                          size="sm"
                          loading={revokingId === machine.id}
                          onClick={() => onRevoke(machine.id)}
                        >
                          {t('machines.revokeConfirm', { label: machine.label })}
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
