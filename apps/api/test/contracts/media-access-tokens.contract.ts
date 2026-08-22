import { describe, expect, it } from 'vitest';

import type { MediaAccessTokens } from '../../src/transcription/application/ports/media-access-tokens';

const TRANSCRIPTION_ID = '7f1c9c2e-0000-4000-8000-00000000ab01';
const RUN_ID = '7f1c9c2e-0000-4000-8000-00000000ab02';
const ISSUED_AT = new Date('2026-05-04T09:00:00.000Z');
const EXPIRES_AT = new Date('2026-05-04T09:02:00.000Z');

/**
 * Contrat du port `MediaAccessTokens`. C'est le seul contrôle d'accès du téléchargement média :
 * la même suite tourne sur le double et sur l'adaptateur signé, sinon les scénarios
 * d'acceptation prouveraient une sécurité que la production n'a pas.
 */
export function describeMediaAccessTokensContract(
  name: string,
  factory: () => MediaAccessTokens,
): void {
  describe(`MediaAccessTokens — ${name}`, () => {
    it('rouvre ce qu\'il a lui-même émis', () => {
      const tokens = factory();

      const token = tokens.issue({
        transcriptionId: TRANSCRIPTION_ID,
        runId: RUN_ID,
        expiresAt: EXPIRES_AT,
      });

      expect(tokens.verify({ token, now: ISSUED_AT })).toEqual({
        transcriptionId: TRANSCRIPTION_ID,
        runId: RUN_ID,
      });
    });

    it('refuse un laissez-passer expiré', () => {
      const tokens = factory();
      const token = tokens.issue({
        transcriptionId: TRANSCRIPTION_ID,
        runId: RUN_ID,
        expiresAt: EXPIRES_AT,
      });

      expect(
        tokens.verify({ token, now: new Date(EXPIRES_AT.getTime() + 1_000) }),
      ).toBeNull();
    });

    it('accepte encore un laissez-passer à l\'instant exact de son expiration', () => {
      const tokens = factory();
      const token = tokens.issue({
        transcriptionId: TRANSCRIPTION_ID,
        runId: RUN_ID,
        expiresAt: EXPIRES_AT,
      });

      expect(tokens.verify({ token, now: EXPIRES_AT })).not.toBeNull();
    });

    it('refuse un laissez-passer bien formé que nous n\'avons pas émis', () => {
      const tokens = factory();
      const legitimate = tokens.issue({
        transcriptionId: TRANSCRIPTION_ID,
        runId: RUN_ID,
        expiresAt: EXPIRES_AT,
      });
      // Même forme, mêmes séparateurs, une expiration lointaine : tout ce qu'un attaquant peut
      // fabriquer en connaissant deux identifiants. Seule la signature lui manque.
      const separator = legitimate.includes('::') ? '::' : '.';
      const forged = [
        TRANSCRIPTION_ID,
        RUN_ID,
        String(new Date('2030-01-01T00:00:00.000Z').getTime()),
      ].join(separator);

      expect(tokens.verify({ token: forged, now: ISSUED_AT })).toBeNull();
    });

    it('refuse un laissez-passer dont on a prolongé l\'expiration', () => {
      const tokens = factory();
      const token = tokens.issue({
        transcriptionId: TRANSCRIPTION_ID,
        runId: RUN_ID,
        expiresAt: EXPIRES_AT,
      });
      const separator = token.includes('::') ? '::' : '.';
      const parts = token.split(separator);
      parts[2] = String(new Date('2030-01-01T00:00:00.000Z').getTime());

      expect(tokens.verify({ token: parts.join(separator), now: ISSUED_AT })).toBeNull();
    });

    it('refuse une chaîne qui n\'a pas la forme d\'un laissez-passer', () => {
      const tokens = factory();

      for (const token of ['', 'inventé', 'a.b', '::::']) {
        expect(tokens.verify({ token, now: ISSUED_AT })).toBeNull();
      }
    });
  });
}
