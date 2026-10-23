/**
 * useLensScanItems - the lens-scan cards, live (spark one-control, WP3).
 *
 * The products come from the one shared read (`roster/lensScanSource`, also a
 * count source); the release cards' versions from the lazy composition cache,
 * read only while `active` (a lane peek or deck that deals them is open).
 * Like the Sign lane's draft mandates, these cards are not in the roster's
 * chips: the lane surfaces append them and the lane join places them
 * (`frontendLanes`).
 */
import { useMemo } from 'react';

import { useTriageCopy } from '@/features/agents/quick-answer/triage/useTriageCopy';
import { useTranslation } from '@/i18n/useTranslation';

import type { DecisionItem } from '../model/decisionModel';
import { useLensScanProducts } from '../roster/lensScanSource';
import { lensToDecisions } from './lensAdapters';
import { useReleaseCompositions } from './releaseCompositions';

const NONE: DecisionItem[] = [];

export interface LensScanItems {
  items: DecisionItem[];
  /** The products read failed (the last good rows still deal). */
  failed: boolean;
  /** At least one products read settled. */
  ready: boolean;
}

export function useLensScanItems(active: boolean): LensScanItems {
  const { t, tx } = useTranslation();
  const triage = useTriageCopy();
  const state = useLensScanProducts(active);
  const compositions = useReleaseCompositions(state.products, active);
  const dc = t.decisionCenter;
  const items = useMemo(
    () => (active && state.products ? lensToDecisions(state.products, compositions, { dc, tx, skip: triage.skip }) : NONE),
    [active, state.products, compositions, dc, tx, triage.skip],
  );
  return { items, failed: state.failed, ready: state.settled };
}
