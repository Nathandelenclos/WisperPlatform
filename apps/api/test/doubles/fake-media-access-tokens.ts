import type { MediaAccessTokens } from '../../src/transcription/application/ports/media-access-tokens';

const SEPARATOR = '::';
/**
 * Signature du double : dérivée du contenu, triviale à lire dans une assertion, mais
 * impossible à produire sans connaître la règle. Elle existe pour que le contrat du port
 * — « un laissez-passer que nous n'avons pas émis est refusé » — soit vérifiable ici comme
 * sur l'adaptateur HMAC.
 *
 * ponytail: signature jouet, suffisante pour un double de test ; la vraie défense est
 * l'HMAC de `HmacMediaAccessTokens`, sur lequel la même suite de contrat tourne.
 */
function sign(payload: string): string {
  // Somme des codes de caractères en base 36 : aucun séparateur possible dans le résultat,
  // impossible à produire sans connaître la règle, et lisible dans un message d'échec.
  const checksum = [...payload].reduce((total, char) => total + char.charCodeAt(0), 0);
  return `signe${checksum.toString(36)}`;
}

/**
 * Laissez-passer lisible dans les assertions. L'adaptateur réel signe le même triplet en
 * HMAC ; le comportement observable — même contenu, même expiration, refus d'un jeton forgé —
 * est identique.
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
