import { useQuery } from '@tanstack/react-query';

/** Sign-in routes opened by the instance, as the instance declares them. */
export type SignInOptions = {
  google: boolean;
};

/**
 * What the server allows, asked to the server. A self-hosted instance without Google
 * credentials must not show a button that fails on click, and a build variable would turn
 * that decision into two configurations to keep in agreement.
 *
 * An unreachable instance or an unexpected answer fall back to “password only”: the route
 * that always exists, hence the safest fallback.
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
    // The configuration of an instance does not change mid-visit.
    staleTime: Infinity,
    retry: false,
  });
}
