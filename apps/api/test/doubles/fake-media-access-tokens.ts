import type { MediaAccessTokens } from '../../src/transcription/application/ports/media-access-tokens';

const SEPARATOR = '::';
/**
 * The double's signature: derived from the content, trivial to read in an assertion, but
 * impossible to produce without knowing the rule. It exists so that the port's contract
 * — "an access token we did not issue is refused" — is verifiable here just as it is on the
 * HMAC adapter.
 *
 * ponytail: toy signature, enough for a test double — the real defence is the HMAC of
 * `HmacMediaAccessTokens`, on which the same contract suite runs.
 */
function sign(payload: string): string {
  // Sum of the character codes in base 36: no separator can appear in the result, impossible to
  // produce without knowing the rule, and readable in a failure message.
  const checksum = [...payload].reduce((total, char) => total + char.charCodeAt(0), 0);
  return `signed${checksum.toString(36)}`;
}

/**
 * Access token readable in the assertions. The real adapter signs the same triplet with HMAC —
 * the observable behaviour (same content, same expiry, refusal of a forged token) is identical.
 */
export class FakeMediaAccessTokens implements MediaAccessTokens {
  issue(p: { transcriptionId: string; runId: string; expiresAt: Date }): string {
    const payload = [p.transcriptionId, p.runId, String(p.expiresAt.getTime())].join(SEPARATOR);
    return [payload, sign(payload)].join(SEPARATOR);
  }

  verify(p: { token: string; now: Date }): { transcriptionId: string; runId: string } | null {
    const parts = p.token.split(SEPARATOR);
    if (parts.length !== 4) {
      return null;
    }
    const [transcriptionId, runId, expiresAt, signature] = parts as [
      string,
      string,
      string,
      string,
    ];
    if (sign([transcriptionId, runId, expiresAt].join(SEPARATOR)) !== signature) {
      return null;
    }
    const expiresAtMs = Number(expiresAt);
    if (!Number.isInteger(expiresAtMs) || expiresAtMs < p.now.getTime()) {
      return null;
    }
    return { transcriptionId, runId };
  }
}
