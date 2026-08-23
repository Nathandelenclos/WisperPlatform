import { useQuery } from '@tanstack/react-query';

/** Voies de connexion ouvertes par l'instance, telles qu'elle les déclare. */
export type SignInOptions = {
  google: boolean;
};

/**
 * Ce que le serveur autorise, demandé au serveur. Une instance auto-hébergée sans
 * identifiants Google ne doit pas afficher un bouton qui échoue au clic, et une variable du
 * build ferait de cette décision deux configurations à tenir d'accord.
 *
 * Une instance injoignable ou une réponse inattendue retombent sur « mot de passe seulement » :
 * c'est la voie qui existe toujours, donc le repli le plus sûr.
 */
async function fetchSignInOptions(signal?: AbortSignal): Promise<SignInOptions> {
  const response = await fetch('/api/sign-in-options', { credentials: 'include', signal });
  if (!response.ok) return { google: false };
  const payload: unknown = await response.json();
  const google =
    typeof payload === 'object' && payload !== null && 'google' in payload
      ? payload.google === true
      : false;
  return { google };
}

export function useSignInOptions() {
  return useQuery({
    queryKey: ['sign-in-options'],
    queryFn: ({ signal }) => fetchSignInOptions(signal),
    // La configuration d'une instance ne change pas en cours de visite.
    staleTime: Infinity,
    retry: false,
  });
}
