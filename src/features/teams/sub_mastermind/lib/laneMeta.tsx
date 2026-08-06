// Identity for the three live-work lanes — shared by every band that names
// them, so Fleet is the same ship and the same ink whether it is an arc on the
// far hex, a face at mid, or a badge at near.
//
// Hoisted out of the mid variants the moment the second one needed it: two
// surfaces rendering the same lane with independently-chosen glyphs is how a
// canvas ends up teaching two vocabularies for one fact.
import { Bot, Cog, type LucideIcon } from 'lucide-react';

import { FleetShipIcon } from '@/features/plugins/fleet/FleetShipIcon';
import type { Translations } from '@/i18n/generated/types';
import { tokenLabel } from '@/i18n/tokenMaps';

import { fleetStateLabel } from './fleetMeta';
import type { LaneKey, ProcessLane } from './farProcesses';

/** Lucide-compatible glyph per lane. Fleet reuses the app's purpose-drawn ship
 *  mark rather than a generic terminal icon — it is the Fleet feature's own
 *  identity, already used in the footer. (FleetShipIcon forwards SVG props, so
 *  it positions inside the canvas's world <svg> exactly like a lucide icon.) */
export const LANE_ICON: Record<LaneKey, LucideIcon | typeof FleetShipIcon> = {
  fleet: FleetShipIcon,
  persona: Bot,
  runner: Cog,
};

export const laneLabel = (t: Translations, key: LaneKey): string =>
  ({
    fleet: t.mastermind.family_fleet,
    persona: t.mastermind.lane_personas,
    runner: t.mastermind.lane_runners,
  })[key];

/**
 * The one-line tooltip for a lane: label, count, and the most urgent state
 * spelled in the app's own vocabulary — Fleet states through the Fleet grid's
 * labels, runner statuses through the execution status tokens. Never a raw
 * machine token (CLAUDE.md status-token rule); personas carry no per-item
 * state, so their tip is just the count.
 */
export const laneTip = (t: Translations, lane: ProcessLane): string => {
  const label = laneLabel(t, lane.key);
  if (lane.count === 0) return `${label} — ${t.mastermind.lane_none}`;
  if (!lane.state) return `${label} — ${lane.count}`;
  const state = lane.key === 'runner'
    ? tokenLabel(t, 'execution', lane.state)
    : fleetStateLabel(t, lane.state);
  return `${label} — ${lane.count} · ${state}`;
};
