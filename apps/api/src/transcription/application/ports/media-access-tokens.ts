/**
 * Short-lived pass handed to a worker so that it can download a media file.
 * It designates only a transcription and a run: the worker learns nothing about the user.
 */
export interface MediaAccessTokens {
  issue(p: { transcriptionId: string; runId: string; expiresAt: Date }): string;
  verify(p: { token: string; now: Date }): { transcriptionId: string; runId: string } | null;
}

export const MEDIA_ACCESS_TOKENS = Symbol('MediaAccessTokens');
