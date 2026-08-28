import { useSystemStore } from '@/stores/systemStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { flashSpotlight } from './flashSpotlight';
import { usePowerMovesStore } from './powerMovesStore';
import type { PowerMove } from './registry';

/** Mirrors GuidedTour's section→sub-tab sequencing: the section must mount
 *  before its tab setter lands, so sub-tabs apply on a short delay. */
const SUB_TAB_DELAY_MS = 120;

/**
 * Credit the move only once its deep link has actually landed.
 *
 * `markTried` used to run on the first line of `launchPowerMove`, before any
 * navigation and long before the spotlight resolved — so a move whose anchor
 * never mounted still incremented the quest board's progress count, and the app
 * could report `anchor-never-mounted` and "you have used this feature" about
 * the same click. A move with no spotlight anchor has nothing to verify: the
 * navigation IS the action, so it is credited immediately.
 */
function creditOnLanding(move: PowerMove): void {
  const anchor = move.spotlightTestId;
  if (!anchor) {
    usePowerMovesStore.getState().markTried(move.id);
    return;
  }
  void flashSpotlight(anchor).then((landed) => {
    if (landed) usePowerMovesStore.getState().markTried(move.id);
  });
}

/**
 * The "Try it" action: deep-links to the move's surface, flashes the one-shot
 * spotlight on the landing anchor, and marks the move tried once it lands.
 */
export function launchPowerMove(move: PowerMove): void {
  const sys = useSystemStore.getState();

  if ('overlay' in move.nav) {
    sys.setHeaderOverlay(move.nav.overlay);
    // Overlay moves get the landing spotlight too — the overlay mounts its own
    // anchor, and skipping the flash here is why an overlay move felt like a
    // dead click compared with a section move.
    creditOnLanding(move);
    return;
  }

  const nav = move.nav;
  sys.setSidebarSection(nav.section);
  if (nav.overviewTab || nav.eventBusTab || nav.pluginTab) {
    window.setTimeout(() => {
      const s = useSystemStore.getState();
      // The user can navigate again inside the delay (another power move, the
      // sidebar, a tour). Applying the sub-tab then would yank them to a tab
      // of a section they already left, so land it only if the section we
      // routed to is still the one on screen.
      if (s.sidebarSection !== nav.section) return;
      if (nav.overviewTab) useOverviewStore.getState().setOverviewTab(nav.overviewTab);
      if (nav.eventBusTab) s.setEventBusTab(nav.eventBusTab);
      if (nav.pluginTab) s.setPluginTab(nav.pluginTab);
    }, SUB_TAB_DELAY_MS);
  }
  creditOnLanding(move);
}
