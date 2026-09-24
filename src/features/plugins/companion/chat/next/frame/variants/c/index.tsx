/**
 * Halo · C — "Spread": the right panel is a collection binder of card-shaped
 * project tiles (Athena first, same family), and decisions play as a card
 * spread: dealt from the binder to a deck, drawn one at a time into an ornate
 * collectible frame, discarded when resolved (contract: `../../slots.ts`).
 *
 * R4 (2026-09-24): three slot objects, one per card-native body treatment
 * (Oracle / Ledger / Runes); everything else about the spread is shared.
 *
 * TODO(prototype, 2026-09-23): consolidate the Athena chat switcher.
 */

import type { DecisionStageProps, HaloSlots } from '../../slots';
import { BinderPanel } from './BinderPanel';
import type { BodyVariant } from './bodies/model';
import { SPREAD_COPY } from './copy';
import { SpreadStage } from './SpreadStage';

function slotsFor(body: BodyVariant): HaloSlots {
  function Stage(props: DecisionStageProps) {
    return <SpreadStage {...props} body={body} />;
  }
  Stage.displayName = `SpreadStage(${body})`;
  return { id: 'c', label: SPREAD_COPY.tab(SPREAD_COPY.bodies[body]), RightPanel: BinderPanel, DecisionStage: Stage };
}

export const HALO_C_ORACLE_SLOTS = slotsFor('oracle');
export const HALO_C_LEDGER_SLOTS = slotsFor('ledger');
export const HALO_C_RUNES_SLOTS = slotsFor('runes');
