/**
 * Overview > Mission Control (`overview/sub_missionControl`): the one
 * consolidated monitoring surface, inside the Overview filter provider, on the
 * synthetic tape in `missionControlTapes.mjs`.
 *
 * The page fetches almost nothing itself — it reads the overview store, and the
 * ROUTE fills it: `OverviewPage` runs `useExecutionDashboardPipeline` above
 * `DashboardWithSubtabs`, so by the time `MissionControlHome` mounts the
 * executions, the dashboard series, the observability bundle and the alert
 * history are already in the store. `prepare` below drives that same pipeline
 * through the mocked IPC, so every number arrives the way it does in the app
 * instead of being hand-assembled into the store.
 *
 * Three things `prepare` must do that a naive "set the tab" step would miss:
 *
 *  1. **`initStoreBus()`**. `useStatusPageData` reads the persona list through
 *     `storeBus.get(AccessorKey.AGENTS_PERSONAS)`, and `storeBus.get` THROWS
 *     for an unregistered accessor. The app wires it in `App.tsx`, which the
 *     harness never mounts — without this the status monitor throws during
 *     render and the shot is an error boundary, not a page.
 *  2. **Settle the pipeline.** `MissionControlHome:181-186` decides between the
 *     ghost, the settled empty state and the real console from
 *     `pipelineFetchedAt.globalExecutions` and `personas.length`. Running
 *     wave 1 is what stamps that key; skipping it paints the ghost forever.
 *  3. **`refreshHealthDashboard()`**. `LeaderboardSection` renders nothing at
 *     all below two ranked agents and otherwise only auto-loads on an idle
 *     callback, which is a race against the screenshot. Computing the health
 *     signals here makes the leaderboard deterministic.
 */
import { useEffect, type ComponentType, type ReactNode } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useAgentStore } from '@/stores/agentStore';
import type { MemoryAction } from '@/features/overview/sub_memories/libs/memoryActions';
import type { HarnessModule } from './registry';

/** The window the route's filter context defaults to (`OverviewFilterProvider`: dayRange 30). */
const DEFAULT_DAYS = 30;

interface Seed {
  memoryActions?: MemoryAction[];
}

/** The tape's seed block; empty when the tape was passed by URL instead of injected. */
function readSeed(): Seed {
  const calls = window.__PAGE_HARNESS_TAPE__?.calls ?? [];
  // Authored beside the view in missionControlTapes.mjs; nothing else writes it.
  return (calls.find((c) => c.cmd === '__harness_seed')?.response as Seed | undefined) ?? {};
}

async function quietly(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (err) {
    console.warn(`[page-harness] prepare step "${label}" failed`, err);
  }
}

async function prepareMissionControl(): Promise<void> {
  // (1) Cross-store accessors. MUST come before anything that renders.
  await quietly('initStoreBus', async () => {
    const { initStoreBus } = await import('@/lib/storeBusWiring');
    initStoreBus();
  });

  useSystemStore.setState({ sidebarSection: 'overview' });
  // `OverviewTab` is a closed union and Mission Control is its 'home' leaf
  // (OverviewPage.tsx:69 -> DashboardWithSubtabs -> DashboardHome ->
  // sub_missionControl); there is no 'dashboard' tab id.
  useOverviewStore.setState({ overviewTab: 'home' });

  // The app loads personas at boot; the vitals agent tile, the status monitor
  // and the leaderboard all resolve names and grades from them.
  await quietly('fetchPersonas', () => useAgentStore.getState().fetchPersonas());

  const s = useOverviewStore.getState();

  // (2) The route's pipeline, in its own two waves. Each wave commits its own
  // `pipelineFetchedAt` bookkeeping, which is the page's settled signal.
  await quietly('runDashboardWave1', () => s.runDashboardWave1(DEFAULT_DAYS));
  await quietly('runDashboardWave2', () => s.runDashboardWave2(DEFAULT_DAYS));
  // Mount-only half of the pipeline: the alert history is what the Vitals
  // "alerts" tile counts through `useAttention`.
  await Promise.allSettled([s.fetchAlertRules(true), s.fetchAlertHistory(true)]);
  s.applyPipelineResults([
    { source: 'alertRules', error: null },
    { source: 'alertHistory', error: null },
  ]);

  // Counters the page READS but nothing on it fetches. `globalExecutionCounts`
  // is a real gap rather than a harness shortcut: the Vitals runs tile and the
  // status ticker both draw `globalExecutionCounts.total`, and its only writer
  // (`fetchGlobalExecutionCounts`) is called from the Activity tab's LLM-calls
  // table — so a fresh Overview visit that lands here really does show 0.
  // `pendingReviewCount` / `unreadReportCount` are fetched by the app chrome
  // (`hooks/sidebar/useBadgeCounts`), which the harness frame does not mount.
  // Both are filled here so the tiles have the numbers a warm app session has.
  await Promise.allSettled([
    s.fetchGlobalExecutionCounts(),
    s.fetchPendingReviewCount(),
    s.fetchUnreadReportCount(),
  ]);

  // (3) Heartbeat signals for the leaderboard matrix.
  await quietly('refreshHealthDashboard', () => s.refreshHealthDashboard());

  // The memory-suggestion pane is localStorage-backed, not IPC: `memorySlice`
  // seeds it from `loadActions()` and only the Memories tab's review ever adds
  // to it, so the fixture travels on the tape and lands in the store here.
  const seed = readSeed();
  if (seed.memoryActions?.length) {
    useOverviewStore.setState({ memoryActions: seed.memoryActions });
  }
}

/**
 * Re-fires the page's own tab-returned-to-the-foreground signal a moment after
 * mount, which is the only thing that gets `UpcomingRoutinesCard` and
 * `AttentionLoopCard` out of their ghost here.
 *
 * Both cards guard their fetch with a module-local `fetchingRef` AND drop the
 * result when the effect that started it has been cleaned up. Under
 * `StrictMode` — which the harness mounts, and so does the app in dev — the
 * first effect starts the request and is then torn down, so its answer is
 * discarded; the second effect's immediate retry is refused by the still-set
 * `fetchingRef`. Nothing else re-runs until the cards' own 30 s interval, long
 * after the shot. Dispatching `visibilitychange` (with `document.hidden`
 * false, as it is here) is the same public signal a user returning to the tab
 * sends, and both cards answer it by refetching — by then `fetchingRef` is
 * clear and the live effect keeps the result.
 *
 * This drives the page through its own behaviour rather than reaching into it,
 * the way `observabilitySurfaces` drives its controls with a click. The
 * StrictMode double-mount race itself is a real defect in those two cards and
 * is NOT fixed here.
 */
function VisibilityNudge({ children }: { children: ReactNode }) {
  useEffect(() => {
    // No once-only ref here: under StrictMode the first run's timers are
    // cleared by its own cleanup, so a `hasRun` guard would make the second
    // run bail and nothing would ever fire — the very race this exists to
    // work around, reproduced one level up.
    const nudge = () => document.dispatchEvent(new Event('visibilitychange'));
    const timers = [300, 900, 1800, 2800].map((ms) => window.setTimeout(nudge, ms));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, []);
  return <>{children}</>;
}

const providers = async () => {
  const { OverviewFilterProvider } = await import('@/features/overview/components/dashboard/OverviewFilterContext');
  return (children: ReactNode) => (
    <OverviewFilterProvider>
      <VisibilityNudge>{children}</VisibilityNudge>
    </OverviewFilterProvider>
  );
};

export const MISSION_CONTROL_MODULES: Record<string, HarnessModule> = {
  'overview/sub_missionControl': {
    // The module INDEX, not MissionControlHome: `index.ts` is the drop-in point
    // the contest winner was wired through, so this shoots whatever the app
    // actually renders rather than a component the page may no longer use.
    load: () => import('@/features/overview/sub_missionControl') as Promise<{ default: ComponentType }>,
    providers,
    prepare: prepareMissionControl,
  },
};
