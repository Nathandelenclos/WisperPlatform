import { createHmac, timingSafeEqual } from 'node:crypto';

import type { MediaAccessTokens } from '../../application/ports/media-access-tokens';

/**
 * Jeton de téléchargement remis à un worker : `<transcriptionId>.<runId>.<expiresAtMs>.<signature>`.
 * La signature est un HMAC-SHA256 base64url du préfixe signé. Le jeton ne transporte donc
 * aucune information sur l'utilisateur (ni identité, ni nom de fichier), il voyage dans un
 * segment d'URL et il expire seul.
 */
export class HmacMediaAccessTokens implements MediaAccessTokens {
  constructor(private readonly secret: string) {}

  issue(p: { transcriptionId: string; runId: string; expiresAt: Date }): string {
    const payload = `${p.transcriptionId}.${p.runId}.${p.expiresAt.getTime()}`;
    return `${payload}.${this.sign(payload)}`;
  }

  verify(p: { token: string; now: Date }): { transcriptionId: string; runId: string } | null {
    // Un jeton invalide n'est jamais une exception : c'est une absence d'autorisation, et
    // aucun message d'erreur ne doit renseigner l'appelant (ni, a fortiori, révéler le secret).
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
    // `timingSafeEqual` exige des longueurs égales : la comparaison de longueur est faite
    // avant, et ne fuit rien qu'un attaquant ne puisse déjà déduire du format du jeton.
    if (expectedBytes.length !== providedBytes.length) return null;
    if (!timingSafeEqual(expectedBytes, providedBytes)) return null;

    if (p.now.getTime() > expiresAt) return null;

    return { transcriptionId, runId };
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }
}
