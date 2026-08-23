import { describe, expect, it } from 'vitest';

import { NodeWorkerKeySecrets } from './node-worker-key-secrets';

describe('NodeWorkerKeySecrets', () => {
  const secrets = new NodeWorkerKeySecrets();

  it('tire un secret de 256 bits, transportable tel quel', () => {
    const secret = secrets.generate();

    // 32 octets en base64url sans remplissage : 43 caractères, aucun `+`, `/` ni `=`.
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('ne tire jamais deux fois le même secret', () => {
    const drawn = new Set(Array.from({ length: 100 }, () => secrets.generate()));

    expect(drawn.size).toBe(100);
  });

  it('rend une empreinte stable, de longueur fixe, qui ne contient pas le secret', () => {
    const secret = secrets.generate();

    const fingerprint = secrets.fingerprint(secret);

    expect(fingerprint).toHaveLength(64);
    expect(fingerprint).toBe(secrets.fingerprint(secret));
    expect(fingerprint).not.toContain(secret);
    expect(secrets.fingerprint(`${secret}x`)).not.toBe(fingerprint);
  });
});
