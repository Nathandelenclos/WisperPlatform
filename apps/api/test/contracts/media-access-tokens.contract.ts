import { describe, expect, it } from 'vitest';

import type { MediaAccessTokens } from '../../src/transcription/application/ports/media-access-tokens';

const TRANSCRIPTION_ID = '7f1c9c2e-0000-4000-8000-00000000ab01';
const RUN_ID = '7f1c9c2e-0000-4000-8000-00000000ab02';
const ISSUED_AT = new Date('2026-05-04T09:00:00.000Z');
const EXPIRES_AT = new Date('2026-05-04T09:02:00.000Z');

/**
 * Contract of the `MediaAccessTokens` port. This is the only access control on the media
 * download: the same suite runs on the double and on the signed adapter, otherwise the
 * acceptance scenarios would prove a security that production does not have.
 */
export function describeMediaAccessTokensContract(
  name: string,
  factory: () => MediaAccessTokens,
): void {
  describe(`MediaAccessTokens — ${name}`, () => {
    it('reopens what it issued itself', () => {
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

    it('refuses an expired access token', () => {
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

    it('still accepts an access token at the exact instant of its expiry', () => {
      const tokens = factory();
      const token = tokens.issue({
        transcriptionId: TRANSCRIPTION_ID,
        runId: RUN_ID,
        expiresAt: EXPIRES_AT,
      });

      expect(tokens.verify({ token, now: EXPIRES_AT })).not.toBeNull();
    });

    it('refuses a well-formed access token we did not issue', () => {
      const tokens = factory();
      const legitimate = tokens.issue({
        transcriptionId: TRANSCRIPTION_ID,
        runId: RUN_ID,
        expiresAt: EXPIRES_AT,
      });
      // Same shape, same separators, a distant expiry: everything an attacker can fabricate
      // knowing two identifiers. Only the signature is missing.
      const separator = legitimate.includes('::') ? '::' : '.';
      const forged = [
        TRANSCRIPTION_ID,
        RUN_ID,
        String(new Date('2030-01-01T00:00:00.000Z').getTime()),
      ].join(separator);

      expect(tokens.verify({ token: forged, now: ISSUED_AT })).toBeNull();
    });

    it('refuses an access token whose expiry was extended', () => {
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

    it('refuses a string that does not have the shape of an access token', () => {
      const tokens = factory();

      for (const token of ['', 'made-up', 'a.b', '::::']) {
        expect(tokens.verify({ token, now: ISSUED_AT })).toBeNull();
      }
    });
  });
}
