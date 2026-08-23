import { describe, expect, it } from 'vitest';

import { UnsupportedPlacementError } from './errors';
import { DEFAULT_PLACEMENT, PLACEMENTS, toPlacement } from './placement';

describe('Placement', () => {
  it('accepte les deux seuls endroits où un calcul peut avoir lieu', () => {
    expect(PLACEMENTS).toEqual(['service', 'owner']);
    expect(toPlacement('service')).toBe('service');
    expect(toPlacement('owner')).toBe('owner');
  });

  it('place le calcul sur le service par défaut', () => {
    expect(DEFAULT_PLACEMENT).toBe('service');
  });

  it('refuse tout le reste, casse et espaces compris', () => {
    for (const raw of ['', 'Service', ' owner', 'ailleurs']) {
      expect(() => toPlacement(raw)).toThrow(UnsupportedPlacementError);
    }
  });
});
