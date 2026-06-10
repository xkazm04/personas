import { useSystemStore } from '@/stores/systemStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { flashSpotlight } from './flashSpotlight';
import { usePowerMovesStore } from './powerMovesStore';
import type { PowerMove } from './registry';

/** Mirrors GuidedTour's section→sub-tab sequencing: the section must mount
 *  before its tab setter lands, so sub-tabs apply on a short delay. */
const SUB_TAB_DELAY_MS = 120;

/**
 * The "Try it" action: marks the move tried, then deep-links to its surface
 * and flashes the one-shot spotlight on the landing anchor.
 */
export function launchPowerMove(move: PowerMove): void {
  usePowerMovesStore.getState().markTried(move.id);
  const sys = useSystemStore.getState();

  if ('overlay' in move.nav) {
    sys.setHeaderOverlay(move.nav.overlay);
    return;
  }

  const nav = move.nav;
  sys.setSidebarSection(nav.section);
  if (nav.overviewTab || nav.eventBusTab || nav.pluginTab) {
    window.setTimeout(() => {
      const s = useSystemStore.getState();
      if (nav.overviewTab) useOverviewStore.getState().setOverviewTab(nav.overviewTab);
      if (nav.eventBusTab) s.setEventBusTab(nav.eventBusTab);
      if (nav.pluginTab) s.setPluginTab(nav.pluginTab);
    }, SUB_TAB_DELAY_MS);
  }
  if (move.spotlightTestId) void flashSpotlight(move.spotlightTestId);
}
