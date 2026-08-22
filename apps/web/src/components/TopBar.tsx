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
      <p className="wordmark">WisperPlatform</p>
      <div className="topbar__user">
        <span className="topbar__name">{displayName}</span>
        {signOutError === null ? null : (
          <span className="topbar__error" role="alert">
            {signOutError}
          </span>
        )}
        <button
          className="button button--ghost"
          type="button"
          disabled={signingOut}
          onClick={onSignOut}
        >
          {signingOut ? 'Déconnexion…' : 'Se déconnecter'}
        </button>
      </div>
    </header>
  );
}
