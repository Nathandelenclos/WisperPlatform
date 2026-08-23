import { useTranslation } from '../i18n';
import { LanguageSwitcher } from './LanguageSwitcher';
import { Button, Notice } from './primitives';

type TopBarProps = {
  displayName: string;
  signingOut: boolean;
  signOutError: string | null;
  onSignOut: () => void;
};

/** Title bar: identity of the platform, signed-in user, language, sign-out. */
export function TopBar({ displayName, signingOut, signOutError, onSignOut }: TopBarProps) {
  const { t } = useTranslation();

  return (
    <header className="topbar">
      {/* The one `h1` of the workspace: the panels that compose it are `h2`. */}
      <h1 className="topbar__brand">
        {/* Sound wave: three bars are enough to say what this is about. */}
        <svg className="topbar__mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="3" y="9" width="3" height="6" rx="1.5" />
          <rect x="10.5" y="4" width="3" height="16" rx="1.5" />
          <rect x="18" y="7" width="3" height="10" rx="1.5" />
        </svg>
        WisperPlatform
      </h1>

      <div className="topbar__account">
        <LanguageSwitcher />
        <span className="topbar__name">{displayName}</span>
        <Button variant="ghost" loading={signingOut} onClick={onSignOut}>
          {signingOut ? t('topBar.signingOut') : t('topBar.signOut')}
        </Button>
      </div>

      {/*
        Live region rendered permanently and empty at rest: a region created at the same time
        as its content is not announced.
      */}
      <div className="topbar__feedback" aria-live="polite">
        {signOutError === null ? null : <Notice tone="error">{signOutError}</Notice>}
      </div>
    </header>
  );
}
