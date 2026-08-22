import { Button, Notice } from './primitives';

type TopBarProps = {
  displayName: string;
  signingOut: boolean;
  signOutError: string | null;
  onSignOut: () => void;
};

/** Barre de titre : identité de la plateforme, utilisateur connecté, déconnexion. */
export function TopBar({ displayName, signingOut, signOutError, onSignOut }: TopBarProps) {
  return (
    <header className="topbar">
      {/* Unique `h1` de l'atelier : les panneaux qui le composent sont des `h2`. */}
      <h1 className="topbar__brand">
        {/* Onde sonore : trois barres suffisent à dire de quoi il est question. */}
        <svg className="topbar__mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="3" y="9" width="3" height="6" rx="1.5" />
          <rect x="10.5" y="4" width="3" height="16" rx="1.5" />
          <rect x="18" y="7" width="3" height="10" rx="1.5" />
        </svg>
        WisperPlatform
      </h1>

      <div className="topbar__account">
        <span className="topbar__name">{displayName}</span>
        <Button variant="ghost" loading={signingOut} onClick={onSignOut}>
          {signingOut ? 'Déconnexion…' : 'Se déconnecter'}
        </Button>
      </div>

      {/*
        Région live rendue en permanence et vide au repos : une région créée en même temps
        que son contenu n'est pas annoncée.
      */}
      <div className="topbar__feedback" aria-live="polite">
        {signOutError === null ? null : <Notice tone="error">{signOutError}</Notice>}
      </div>
    </header>
  );
}
