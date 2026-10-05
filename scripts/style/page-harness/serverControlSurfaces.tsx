/**
 * Spark server-control: Browser > Server control (the page at the `whitelist`
 * route), on the synthetic tapes in `serverControlTapes.mjs`.
 *
 *   browser/servers/rack          the Rack prototype, ten servers in every state
 *   browser/servers/portmap       the Port map prototype, same fleet
 *   browser/servers/switchboard   the Switchboard prototype, same fleet
 *   browser/servers/tiles         the Live tiles prototype, same fleet
 *   browser/servers/empty         no app servers yet (whichever variant is stored)
 *
 * The variant is chosen the way the operator chooses it: the switcher's stored
 * value, seeded in `prepare` before the page first renders.
 */
import { useSystemStore } from '@/stores/systemStore';
import type { HarnessModule } from './registry';

const VARIANT_KEY = 'personas.browser.servers.variant';

function prepare(variant: string | null): () => void {
  return () => {
    try {
      if (variant) localStorage.setItem(VARIANT_KEY, variant);
    } catch (err) {
      console.warn('[page-harness] variant seed failed', err);
    }
    useSystemStore.setState({ sidebarSection: 'teams', teamsTab: 'whitelist' });
  };
}

const page = () => import('@/features/browser/whitelist/WhitelistPage');

export const SERVER_CONTROL_MODULES: Record<string, HarnessModule> = {
  'browser/servers/rack': { load: page, prepare: prepare('rack') },
  'browser/servers/portmap': { load: page, prepare: prepare('portmap') },
  'browser/servers/switchboard': { load: page, prepare: prepare('switchboard') },
  'browser/servers/tiles': { load: page, prepare: prepare('tiles') },
  'browser/servers/empty': { load: page, prepare: prepare(null) },
};
