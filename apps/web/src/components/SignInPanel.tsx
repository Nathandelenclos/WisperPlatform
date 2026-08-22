import { useState } from 'react';
import type { AuthCommand } from '../auth/session';

type SignInPanelProps = {
  onSubmit: (command: AuthCommand) => void;
  submitting: boolean;
  errorMessage: string | null;
  minPasswordLength: number;
};

/**
 * Connexion et inscription. Le composant ne connaît que ses champs et son mode
 * d'affichage : la commande part en callback.
 */
export function SignInPanel({
  onSubmit,
  submitting,
  errorMessage,
  minPasswordLength,
}: SignInPanelProps) {
  const [intent, setIntent] = useState<AuthCommand['intent']>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const signingUp = intent === 'sign-up';

  return (
    <main className="signin">
      <div className="signin__card">
        <p className="wordmark">WisperPlatform</p>
        <h1 className="signin__title">
          {signingUp ? 'Créer un compte' : 'Transcrire vos médias'}
        </h1>
        <p className="signin__lede">
          Vos fichiers, vos transcriptions, sur votre serveur. Rien ne sort d'ici.
        </p>

        <form
          className="form"
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault();
            if (submitting) return;
            onSubmit(
              signingUp ? { intent: 'sign-up', name, email, password } : { intent: 'sign-in', email, password },
            );
          }}
        >
          {signingUp ? (
            <div className="field">
              <label className="field__label" htmlFor="signin-name">
                Nom affiché
              </label>
              <input
                className="field__input"
                id="signin-name"
                name="name"
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={(changeEvent) => setName(changeEvent.target.value)}
              />
            </div>
          ) : null}

          <div className="field">
            <label className="field__label" htmlFor="signin-email">
              Adresse e-mail
            </label>
            <input
              className="field__input"
              id="signin-email"
              name="email"
              type="email"
              autoComplete={signingUp ? 'email' : 'username'}
              required
              value={email}
              onChange={(changeEvent) => setEmail(changeEvent.target.value)}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="signin-password">
              Mot de passe
            </label>
            <input
              className="field__input"
              id="signin-password"
              name="password"
              type="password"
              autoComplete={signingUp ? 'new-password' : 'current-password'}
              required
              minLength={minPasswordLength}
              aria-describedby={signingUp ? 'signin-password-hint' : undefined}
              value={password}
              onChange={(changeEvent) => setPassword(changeEvent.target.value)}
            />
            {signingUp ? (
              <p className="field__hint" id="signin-password-hint">
                {minPasswordLength} caractères minimum.
              </p>
            ) : null}
          </div>

          {errorMessage === null ? null : (
            <p className="notice notice--error" role="alert">
              {errorMessage}
            </p>
          )}

          <button className="button button--primary" type="submit" disabled={submitting}>
            {submitting
              ? signingUp
                ? 'Création…'
                : 'Connexion…'
              : signingUp
                ? 'Créer le compte'
                : 'Se connecter'}
          </button>
        </form>

        <p className="signin__switch">
          {signingUp ? 'Vous avez déjà un compte ?' : 'Première visite ?'}{' '}
          <button
            className="button button--link"
            type="button"
            onClick={() => setIntent(signingUp ? 'sign-in' : 'sign-up')}
          >
            {signingUp ? 'Se connecter' : 'Créer un compte'}
          </button>
        </p>
      </div>
    </main>
  );
}
