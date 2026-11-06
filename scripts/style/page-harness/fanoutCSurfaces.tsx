/**
 * console-style fan-out, partition C: harness entries for this partition's pages.
 * Owned by the partition-C builder; registry.tsx spreads it (wired by the Director).
 *
 *   plugins/browse       PluginBrowsePage, every plugin enabled
 *   companions/landing   LandingPage
 *   athena/setup|memory|decisions   AthenaPage tabs (via the real route component)
 *   curator/council|blueprint|process
 *   plugins/drive        DrivePage
 *   twin/profiles|hub    TwinPage tabs
 * Reused (already registered): athena/chat/idle, companions/overseer/scorecard, twin/detail.
 */
import { useSystemStore } from '@/stores/systemStore';
import type { PluginTab } from '@/lib/types/types';
import type { HarnessModule } from './registry';

const companions = (page: string): HarnessModule['prepare'] => () => {
  useSystemStore.setState({ sidebarSection: 'companions', companionsPage: page } as never);
};

const athenaTab = (tab: string): HarnessModule => ({
  load: () => import('@/features/companions/athena/AthenaPage'),
  prepare: companions(`athena:${tab}`),
});

const twinTab = (tab: string): HarnessModule => ({
  load: () => import('@/features/plugins/twin/TwinPage'),
  prepare: () => {
    useSystemStore.setState({ sidebarSection: 'plugins', pluginTab: 'twin', twinTab: tab } as never);
  },
});

export const FANOUT_C_MODULES: Record<string, HarnessModule> = {
  'plugins/browse': {
    load: () => import('@/features/plugins/PluginBrowsePage'),
    prepare: () => {
      useSystemStore.setState({
        sidebarSection: 'plugins',
        pluginTab: 'browse',
        enabledPlugins: new Set<PluginTab>(['dev-tools', 'drive', 'twin']),
      } as never);
    },
  },
  'companions/landing': { load: () => import('@/features/companions/landing/LandingPage'), prepare: companions('landing') },
  'athena/setup': athenaTab('setup'),
  'athena/memory': athenaTab('memory'),
  'athena/decisions': athenaTab('decisions'),
  'curator/council': { load: () => import('@/features/companions/curator/council/CouncilPage'), prepare: companions('curator:council') },
  'curator/blueprint': { load: () => import('@/features/companions/curator/blueprint/BlueprintPage'), prepare: companions('curator:blueprint') },
  'curator/process': { load: () => import('@/features/companions/curator/process/ProcessPage'), prepare: companions('curator:process') },
  'plugins/drive': {
    load: () => import('@/features/plugins/drive/DrivePage'),
    prepare: () => { useSystemStore.setState({ sidebarSection: 'plugins', pluginTab: 'drive' } as never); },
  },
  'twin/profiles': twinTab('profiles'),
  'twin/hub': twinTab('hub'),
};
