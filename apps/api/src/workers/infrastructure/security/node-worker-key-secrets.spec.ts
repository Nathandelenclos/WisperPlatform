import { describe, expect, it } from 'vitest';

import { NodeWorkerKeySecrets } from './node-worker-key-secrets';

describe('NodeWorkerKeySecrets', () => {
  const secrets = new NodeWorkerKeySecrets();

  it('draws a 256-bit secret, transportable as-is', () => {
    const secret = secrets.generate();

    // 32 bytes in base64url without padding: 43 characters, no `+`, `/` or `=`.
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('never draws the same secret twice', () => {
    const drawn = new Set(Array.from({ length: 100 }, () => secrets.generate()));

    expect(drawn.size).toBe(100);
  });

  it('returns a stable, fixed-length fingerprint that does not contain the secret', () => {
    const secret = secrets.generate();

    const fingerprint = secrets.fingerprint(secret);

    expect(fingerprint).toHaveLength(64);
    expect(fingerprint).toBe(secrets.fingerprint(secret));
    expect(fingerprint).not.toContain(secret);
    expect(secrets.fingerprint(`${secret}x`)).not.toBe(fingerprint);
  });
});
