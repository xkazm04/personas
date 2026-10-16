/**
 * Synthetic lens-scan products for the WP3 card tests (spark one-control).
 * The repo is PUBLIC: every name here is made up, never a row of a live store.
 */
import { en } from '@/i18n/en';
import type { LensScanProduct } from '@/lib/bindings/LensScanProduct';

import type { LensCopy } from '../lensAdapters';

export function product(over: Partial<LensScanProduct> = {}): LensScanProduct {
  return {
    projectId: 'proj-teapot',
    name: 'Teapot Works',
    root: 'C:/sample/teapot-works',
    storeVersion: 3,
    counts: {},
    awaitingTriage: 0,
    unreleasedAccepted: 0,
    lastRunAt: '2026-10-15T10:00:00.000Z',
    hasMap: true,
    mapVersion: 3,
    features: 4,
    lenses: 2,
    measuredFacets: 6,
    hasEvents: false,
    ...over,
  };
}

export const tx = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k]));

/** The English catalog's own words, as the adapters receive them. */
export function lensCopy(): LensCopy {
  return { dc: en.decisionCenter, tx, skip: 'Later' };
}
