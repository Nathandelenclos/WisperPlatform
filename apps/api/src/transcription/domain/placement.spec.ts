import { describe, expect, it } from 'vitest';

import { UnsupportedPlacementError } from './errors';
import { DEFAULT_PLACEMENT, PLACEMENTS, toPlacement } from './placement';

describe('Placement', () => {
  it('accepts the only two places where a computation can happen', () => {
    expect(PLACEMENTS).toEqual(['service', 'owner']);
    expect(toPlacement('service')).toBe('service');
    expect(toPlacement('owner')).toBe('owner');
  });

  it('places the computation on the service by default', () => {
    expect(DEFAULT_PLACEMENT).toBe('service');
  });

  it('rejects everything else, casing and whitespace included', () => {
    for (const raw of ['', 'Service', ' owner', 'ailleurs']) {
      expect(() => toPlacement(raw)).toThrow(UnsupportedPlacementError);
    }
  });
});
