/**
 * Halo · C — "Spread": the right panel is a collection binder of card-shaped
 * project tiles (Athena first, same family), and decisions play as a card
 * spread: dealt from the binder to a deck, drawn one at a time into an ornate
 * collectible frame, discarded when resolved (contract: `../../slots.ts`).
 *
 * TODO(prototype, 2026-09-23): consolidate the Athena chat switcher.
 */

import type { HaloSlots } from '../../slots';
import { BinderPanel } from './BinderPanel';
import { SPREAD_COPY } from './copy';
import { SpreadStage } from './SpreadStage';

export const HALO_C_SLOTS: HaloSlots = {
  id: 'c',
  label: SPREAD_COPY.label,
  RightPanel: BinderPanel,
  DecisionStage: SpreadStage,
};
