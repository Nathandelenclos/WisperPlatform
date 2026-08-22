import type { MediaAccessTokens } from '../../src/transcription/application/ports/media-access-tokens';

const SEPARATOR = '::';

/**
 * Laissez-passer en clair, lisible dans les assertions. L'adaptateur réel signe le même
 * triplet en HMAC ; le comportement observable — même contenu, même expiration — est identique.
 */
export class FakeMediaAccessTokens implements MediaAccessTokens {
  issue(p: { transcriptionId: string; runId: string; expiresAt: Date }): string {
    return [p.transcriptionId, p.runId, String(p.expiresAt.getTime())].join(SEPARATOR);
  }

  verify(p: { token: string; now: Date }): { transcriptionId: string; runId: string } | null {
    const parts = p.token.split(SEPARATOR);
    if (parts.length !== 3) {
      return null;
    }
    const [transcriptionId, runId, expiresAt] = parts;
    const expiresAtMs = Number(expiresAt);
    if (!Number.isInteger(expiresAtMs) || expiresAtMs < p.now.getTime()) {
      return null;
    }
    return { transcriptionId, runId };
  }
}
