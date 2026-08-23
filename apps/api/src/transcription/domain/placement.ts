import { UnsupportedPlacementError } from './errors';

/**
 * Where a transcription must be computed:
 * - `service`: the platform's own workers;
 * - `owner`: the machines declared by the owner of the request.
 *
 * There is never an automatic switch from one placement to the other. A request placed on its
 * owner's machine waits for that machine, for as long as it takes: the owner is the one who
 * decides to hand it back to the service, nobody else.
 */
export const PLACEMENTS = ['service', 'owner'] as const;
export type Placement = (typeof PLACEMENTS)[number];

/** By default the platform computes: that is the service rendered, machine or no machine. */
export const DEFAULT_PLACEMENT: Placement = 'service';

function isPlacement(candidate: string): candidate is Placement {
  return (PLACEMENTS as readonly string[]).includes(candidate);
}

/** Trust boundary: a placement comes from a request body, never from the code. */
export function toPlacement(raw: string): Placement {
  if (!isPlacement(raw)) {
    throw new UnsupportedPlacementError(`unknown placement: ${raw}`);
  }
  return raw;
}
