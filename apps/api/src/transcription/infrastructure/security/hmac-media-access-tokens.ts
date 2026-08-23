import { createHmac, timingSafeEqual } from 'node:crypto';

import type { MediaAccessTokens } from '../../application/ports/media-access-tokens';

/**
 * Download token handed to a worker: `<transcriptionId>.<runId>.<expiresAtMs>.<signature>`.
 * The signature is a base64url HMAC-SHA256 of the signed prefix. The token therefore carries
 * no information about the user (neither identity nor file name), it travels inside a URL
 * segment and it expires on its own.
 */
export class HmacMediaAccessTokens implements MediaAccessTokens {
  constructor(private readonly secret: string) {}

  issue(p: { transcriptionId: string; runId: string; expiresAt: Date }): string {
    const payload = `${p.transcriptionId}.${p.runId}.${p.expiresAt.getTime()}`;
    return `${payload}.${this.sign(payload)}`;
  }

  verify(p: { token: string; now: Date }): { transcriptionId: string; runId: string } | null {
    // An invalid token is never an exception: it is an absence of authorization, and no error
    // message must tell the caller anything (let alone reveal the secret).
    const parts = p.token.split('.');
    if (parts.length !== 4) return null;
    const [transcriptionId, runId, expiresAtMs, signature] = parts as [
      string,
      string,
      string,
      string,
    ];

    const expiresAt = Number(expiresAtMs);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) return null;

    const expected = this.sign(`${transcriptionId}.${runId}.${expiresAtMs}`);
    const expectedBytes = Buffer.from(expected, 'utf8');
    const providedBytes = Buffer.from(signature, 'utf8');
    // `timingSafeEqual` requires equal lengths: the length comparison happens first, and leaks
    // nothing an attacker could not already deduce from the token format.
    if (expectedBytes.length !== providedBytes.length) return null;
    if (!timingSafeEqual(expectedBytes, providedBytes)) return null;

    if (p.now.getTime() > expiresAt) return null;

    return { transcriptionId, runId };
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }
}
