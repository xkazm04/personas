/**
 * Spark server-control: Browser > Server control (the page at the `whitelist`
 * route), on the synthetic tapes in `serverControlTapes.mjs`.
 *
 *   browser/servers         the server tiles, ten servers in every state
 *   browser/servers/empty   no app servers yet
 *   browser/servers/add     the Add app picker open over the tiles
 *
 * (Live tiles won the 2026-10-06 prototype round; the Rack, Port map and
 * Switchboard modules went with their variants.)
 */
import { useSystemStore } from '@/stores/systemStore';
import type { HarnessModule } from './registry';

function prepare(): void {
  useSystemStore.setState({ sidebarSection: 'teams', teamsTab: 'whitelist' });
}

const page = () => import('@/features/browser/whitelist/WhitelistPage');

export const SERVER_CONTROL_MODULES: Record<string, HarnessModule> = {
  'browser/servers': { load: page, prepare },
  'browser/servers/empty': { load: page, prepare },
  'browser/servers/add': {
    load: async () => {
      const [{ default: Page }, { default: AddAppModal }] = await Promise.all([
        page(),
        import('@/features/browser/servers/AddAppModal'),
      ]);
      return { default: () => (<><Page /><AddAppModal isOpen onClose={() => {}} /></>) };
    },
    prepare,
  },
};
