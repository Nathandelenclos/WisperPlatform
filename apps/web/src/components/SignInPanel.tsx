import { useState } from 'react';
import type { AuthCommand } from '../auth/session';
import { useTranslation } from '../i18n';
import { LanguageSwitcher } from './LanguageSwitcher';
import { Button, Field, Notice, TextInput } from './primitives';

type SignInPanelProps = {
  onSubmit: (command: AuthCommand) => void;
  submitting: boolean;
  errorMessage: string | null;
  minPasswordLength: number;
  /** True when the instance has Google credentials: otherwise the button does not exist. */
  googleAvailable: boolean;
  onGoogle: () => void;
  googleSubmitting: boolean;
};

/**
 * Sign-in and sign-up. The component knows only its fields and its display mode: the command
 * leaves through a callback.
 *
 * Both modes share the same input state: switching from one to the other loses nothing, which
 * is precisely the moment one hesitates.
 */
export function SignInPanel({
  onSubmit,
  submitting,
  errorMessage,
  minPasswordLength,
  googleAvailable,
  onGoogle,
  googleSubmitting,
}: SignInPanelProps) {
  const { t } = useTranslation();
  const [intent, setIntent] = useState<AuthCommand['intent']>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const signingUp = intent === 'sign-up';

  return (
    <main className="signin">
      <div className="signin__card panel">
        {/*
          The language sits on the brand line, at the very top: someone who does not read the
          language of this screen must be able to change it before reading anything else — the
          form included.
        */}
        <div className="signin__top">
          <p className="signin__brand">
            <svg className="signin__mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <rect x="3" y="9" width="3" height="6" rx="1.5" />
              <rect x="10.5" y="4" width="3" height="16" rx="1.5" />
              <rect x="18" y="7" width="3" height="10" rx="1.5" />
            </svg>
            WisperPlatform
          </p>
          <LanguageSwitcher />
        </div>

        <div className="signin__head">
          <h1 className="signin__title">
            {signingUp ? t('signIn.signUpTitle') : t('signIn.signInTitle')}
          </h1>
          {/* What the product does, in one line: a visitor arriving cold reads it first. */}
          <p className="signin__tagline">{t('signIn.tagline')}</p>
        </div>

        <form
          className="signin__form"
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault();
            if (submitting) return;
            onSubmit(
              signingUp
                ? { intent: 'sign-up', name, email, password }
                : { intent: 'sign-in', email, password },
            );
          }}
        >
          {signingUp ? (
            <Field id="signin-name" label={t('signIn.nameLabel')}>
              {(fieldProps) => (
                <TextInput
                  {...fieldProps}
                  name="name"
                  type="text"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(changeEvent) => setName(changeEvent.target.value)}
                />
              )}
            </Field>
          ) : null}

          <Field id="signin-email" label={t('signIn.emailLabel')}>
            {(fieldProps) => (
              <TextInput
                {...fieldProps}
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(changeEvent) => setEmail(changeEvent.target.value)}
              />
            )}
          </Field>

          <Field
            id="signin-password"
            label={t('signIn.passwordLabel')}
            hint={signingUp ? t('signIn.passwordHint', { min: minPasswordLength }) : undefined}
          >
            {(fieldProps) => (
              <TextInput
                {...fieldProps}
                name="password"
                type="password"
                autoComplete={signingUp ? 'new-password' : 'current-password'}
                required
                minLength={signingUp ? minPasswordLength : undefined}
                value={password}
                onChange={(changeEvent) => setPassword(changeEvent.target.value)}
              />
            )}
          </Field>

          <p className="signin__required">{t('signIn.allRequired')}</p>

          {/*
            Live region rendered permanently and empty at rest: a region created at the same
            time as its content is not announced.
          */}
          <div className="signin__feedback" aria-live="polite">
            {errorMessage === null ? null : (
              <Notice
                tone="error"
                title={signingUp ? t('signIn.signUpRefused') : t('signIn.signInRefused')}
              >
                {errorMessage}
              </Notice>
            )}
          </div>

          <Button type="submit" variant="primary" loading={submitting}>
            {submitting
              ? signingUp
                ? t('signIn.signingUp')
                : t('signIn.signingIn')
              : signingUp
                ? t('signIn.submitSignUp')
                : t('signIn.signInTitle')}
          </Button>
        </form>

        {/*
          Alternative route, hence after the form: it does not cut across the typing of someone
          who already has a password. The label says the same verb in both modes — with Google,
          signing up and signing in are the same gesture.
        */}
        {googleAvailable ? (
          <div className="signin__alternative">
            <p className="signin__separator">
              <span>{t('signIn.or')}</span>
            </p>
            <Button variant="secondary" loading={googleSubmitting} onClick={onGoogle}>
              <svg
                className="signin__provider-mark"
                viewBox="0 0 18 18"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62Z" />
                <path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 0 0 9 18Z" />
                <path d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.01-2.34Z" />
                <path d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58Z" />
              </svg>
              {googleSubmitting ? t('signIn.googleOpening') : t('signIn.google')}
            </Button>
          </div>
        ) : null}

        <div className="signin__switch">
          <p className="signin__switch-text">
            {signingUp ? t('signIn.haveAccount') : t('signIn.firstVisit')}
          </p>
          <Button variant="secondary" onClick={() => setIntent(signingUp ? 'sign-in' : 'sign-up')}>
            {signingUp ? t('signIn.signInTitle') : t('signIn.signUpTitle')}
          </Button>
        </div>
      </div>
    </main>
  );
}
