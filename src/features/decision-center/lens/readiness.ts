/**
 * readiness - how ready a lens-scan product is to be drawn (spark bp-fidelity, Stage A): bp's
 * `lib/scan/readiness.ts readinessLevel`, read off the fields `lens_scan_products` carries
 * (`LensScanProduct.hasMap` .. `hasEvents`, computed by the Rust reader the way bp's
 * `readiness.server.ts` computes them).
 *
 * Every listed product has a store (the list is "projects whose root holds scan.db") and a root
 * (it was found there), so bp's `rootExists` and `store` are true by construction; a store that
 * did not open reads no facets, exactly as bp's `readStore` answers 0 on an error.
 *
 * React-free and pure: the Monitor's project list and the sheet's switcher read the same verdict.
 */
import type { LensScanProduct } from '@/api/lensScan';

import type { ReadinessLevel } from '../blueprint/source';

type ReadinessFields = Pick<LensScanProduct, 'hasMap' | 'measuredFacets' | 'hasEvents'>;

/**
 * The store did not open: its counts are unknown, not zero. Every surface that prints a figure from the store says so
 * instead of reading the zeros an unopened store leaves behind (a project that failed to open is not "map only").
 */
export const storeUnreadable = (p: Pick<LensScanProduct, 'error'>): boolean => !!p.error;

/**
 * missing  = no readable map: the product cannot be drawn.
 * map-only = the map draws, nothing is measured yet.
 * measured = the map and at least one reading.
 * full     = measured, plus the events log.
 */
export function readinessLevel(p: ReadinessFields): ReadinessLevel {
  if (!p.hasMap) return 'missing';
  if (p.measuredFacets === 0) return 'map-only';
  return p.hasEvents ? 'full' : 'measured';
}
