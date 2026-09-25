/**
 * Kit batch home-1 (`home/sub_welcome` + `home/components/HomePage`): the DEV
 * Welcome tab as HomePage mounts it (a KeepAlive pane in the Home shell), on the
 * synthetic tapes in `homeWelcomeTapes.mjs`, in the three states a user can reach.
 *
 *   home/welcome            a returning operator: since-you-left briefing (runs
 *                           with failures, alerts, approvals) and the resume
 *                           banner on a fresh failed run
 *   home/welcome/first-run  a fresh profile: no personas, onboarding not done,
 *                           no last-seen anchor, so the Get Started band shows
 *   home/welcome/edit       the briefing cannot derive (the run list fails) and
 *                           the resume banner points at the last edited agent
 *
 * The state that lives outside IPC (the last-seen anchor, the last-edited
 * marker, onboarding) is seeded in `prepare`, before the page first renders.
 */
import { useSystemStore } from '@/stores/systemStore';
import type { HarnessModule } from './registry';

const T0 = Date.parse('2026-09-22T15:40:00.000Z');
const LAST_SEEN_KEY = 'personas:home-last-seen';
const LAST_EDITED_KEY = 'personas:last-edited-persona';

function seed(values: Record<string, string | null>): void {
  for (const [k, v] of Object.entries(values)) {
    try {
      if (v == null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch (err) {
      console.warn('[page-harness] localStorage seed failed', err);
    }
  }
}

async function prepareWelcome(opts: { lastSeenMinutesAgo: number | null; lastEdited?: string; freshProfile?: boolean }): Promise<void> {
  seed({
    [LAST_SEEN_KEY]: opts.lastSeenMinutesAgo == null ? null : String(T0 - opts.lastSeenMinutesAgo * 60_000),
    [LAST_EDITED_KEY]: opts.lastEdited ? JSON.stringify({ personaId: opts.lastEdited, at: T0 - 90 * 60_000 }) : null,
  });
  useSystemStore.setState({
    sidebarSection: 'home',
    homeTab: 'welcome',
    onboardingCompleted: !opts.freshProfile,
  });
  // The app loads personas at boot; the Get Started band and the resume banner read them.
  try {
    const { useAgentStore } = await import('@/stores/agentStore');
    await useAgentStore.getState().fetchPersonas();
  } catch (err) {
    console.warn('[page-harness] fetchPersonas failed', err);
  }
}

const home = () => import('@/features/home/components/HomePage');

export const HOME_WELCOME_MODULES: Record<string, HarnessModule> = {
  'home/welcome': { load: home, prepare: () => prepareWelcome({ lastSeenMinutesAgo: 60 * 14 }) },
  'home/welcome/first-run': { load: home, prepare: () => prepareWelcome({ lastSeenMinutesAgo: null, freshProfile: true }) },
  'home/welcome/edit': { load: home, prepare: () => prepareWelcome({ lastSeenMinutesAgo: 60 * 3, lastEdited: 'p-release' }) },
};
