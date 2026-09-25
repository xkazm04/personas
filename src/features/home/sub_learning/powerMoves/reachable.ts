import { overviewItems, eventBusItems } from '@/features/shared/chrome/sidebar/sidebarData';
import { type Tier, TIERS, isTierVisible } from '@/lib/constants/uiModes';
import { navSection, passesGates } from '@/lib/navigation/registry';
import type { PowerMove } from './registry';

/**
 * Whether a power move's destination is one THIS build actually shows.
 *
 * Several moves deep-link into a surface the sidebar hides: `dead-letter` is
 * `devOnly` (absent from production builds), `executions` is gated at
 * `minTier: TEAM`, and two moves now land in the TEAM-gated Companions section. The content router renders purely by tab id
 * with no tier or dev check, so offering those rows on a starter build sent the
 * user to a surface with no sidebar row — and, once there, no way back except
 * the same link. Rather than teach the router a tier policy it does not own, the
 * quest board simply stops offering a move it cannot land, reading the gates the
 * sidebar already declares.
 *
 * Overlay moves are always reachable: an overlay is summoned, not routed, and
 * carries no sidebar gate.
 */
export function isPowerMoveReachable(move: PowerMove, tier: Tier): boolean {
  if ('overlay' in move.nav) return true;
  const { overviewTab, eventBusTab } = move.nav;

  // The SECTION gate, not only the tab gate. Until 2026-09-22 every gated
  // destination happened to be a tab inside an ungated section, so reading tab
  // gates alone was indistinguishable from correct. Moving the Director move to
  // the TEAM-gated Companions section is the case that separates them: its
  // destination page carries no gate of its own, so without this a starter
  // build would offer a "Try it" for a section its rail does not show.
  if (!passesGates(navSection(move.nav.section).gates, {
    isDev: import.meta.env.DEV,
    isTierVisible: (min) => isTierVisible(min, tier),
  })) {
    return false;
  }

  if (overviewTab) {
    const item = overviewItems.find((i) => i.id === overviewTab);
    if (item && !isGateOpen(item, tier)) return false;
  }
  if (eventBusTab) {
    const item = eventBusItems.find((i) => i.id === eventBusTab);
    if (item && !isGateOpen(item, tier)) return false;
  }
  // A pluginTab destination has no gate declaration to read; the plugins nav
  // filters its own list at render time and a missing entry is not a gate.
  return true;
}

function isGateOpen(item: { minTier?: Tier; devOnly?: boolean }, tier: Tier): boolean {
  if (item.devOnly && !import.meta.env.DEV) return false;
  return isTierVisible(item.minTier ?? TIERS.STARTER, tier);
}
