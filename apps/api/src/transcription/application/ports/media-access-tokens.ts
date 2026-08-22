/**
 * Laissez-passer à durée de vie courte remis à un worker pour qu'il télécharge un média.
 * Il ne désigne qu'une transcription et un run : le worker n'apprend rien de l'utilisateur.
 */
export interface MediaAccessTokens {
  issue(p: { transcriptionId: string; runId: string; expiresAt: Date }): string;
  verify(p: { token: string; now: Date }): { transcriptionId: string; runId: string } | null;
}

export const MEDIA_ACCESS_TOKENS = Symbol('MediaAccessTokens');
