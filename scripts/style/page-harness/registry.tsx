/**
 * The ONLY per-module code in the page harness. Each entry says which page
 * component to mount, which providers the app mounts above it, and what store
 * state the app already holds when a user reaches it (the route, boot-time
 * store preloads). All data arrives through the mocked IPC, from the tape.
 *
 * Adding a module: add an entry here and in `modules.json` (record steps and
 * boot commands for the recorder), then record a tape or add a synthetic
 * builder in `synthetic-tapes.mjs`.
 */
import { useEffect, type ComponentType, type ReactNode } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useAgentStore } from '@/stores/agentStore';
import { TONE_MODULES } from './toneSurfaces';

type Wrap = (children: ReactNode) => ReactNode;

export interface HarnessModule {
  /** Lazy import of the page component (default export). */
  load: () => Promise<{ default: ComponentType }>;
  /** Lazy providers the app mounts above this page. */
  providers?: () => Promise<Wrap>;
  /** Put the stores in the state the app holds on this route. Runs after the tape is installed. */
  prepare?: () => Promise<void> | void;
}

async function quietly(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (err) {
    console.warn(`[page-harness] prepare step "${label}" failed`, err);
  }
}

export const MODULES: Record<string, HarnessModule> = {
  'overview/sub_events': {
    load: () => import('@/features/overview/sub_events/components/EventLogList'),
    providers: async () => {
      const { OverviewFilterProvider } = await import('@/features/overview/components/dashboard/OverviewFilterContext');
      return (children) => <OverviewFilterProvider>{children}</OverviewFilterProvider>;
    },
    prepare: async () => {
      useSystemStore.setState({ sidebarSection: 'overview' });
      useOverviewStore.setState({ overviewTab: 'events' });
      // The app loads personas at boot; the events table resolves names from them.
      await quietly('fetchPersonas', () => useAgentStore.getState().fetchPersonas());
    },
  },
  'home/sub_releases': {
    load: () => import('@/features/home/sub_releases/HomeReleases'),
    prepare: () => {
      useSystemStore.setState({ sidebarSection: 'home', homeTab: 'roadmap' });
    },
  },
  ...TONE_MODULES,
  // Probes for `shoot.mjs --self-test`: each must make the shooter exit non-zero.
  '__selftest/empty': {
    load: async () => ({ default: () => <div /> }),
  },
  '__selftest/console-error': {
    load: async () => ({
      default: function ConsoleErrorProbe() {
        useEffect(() => console.error('[page-harness] self-test probe: deliberate console error'), []);
        return <div className="p-6 typo-body">This probe renders plenty of text so that only its console error can fail the shot.</div>;
      },
    }),
  },
};
