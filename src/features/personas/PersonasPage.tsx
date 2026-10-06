import { idlePrefetch } from "@/lib/idlePrefetch";
import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { motion, AnimatePresence } from 'framer-motion';

import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
import Sidebar from '@/features/shared/chrome/sidebar/Sidebar';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import { CredentialNavProvider } from '@/features/vault/shared/hooks/CredentialNavContext';
import { ErrorBanner } from '@/features/shared/components/feedback/ErrorBanner';
import { ErrorBoundary } from '@/features/shared/components/feedback/ErrorBoundary';
import DesktopFooter from '@/features/shared/chrome/footer/DesktopFooter';
import { useAthenaFleetBridge } from '@/features/companions/athena/useAthenaFleetBridge';
import { useMcpRequestBridge } from '@/features/companions/athena/mcp/useMcpRequestBridge';
import { useOperativeMemoryBridge } from '@/features/companions/athena/orchestration/useOperativeMemoryBridge';
import { useCanvasControlBridge } from '@/features/teams/sub_mastermind/lib/useCanvasControlBridge';
import { useCanvasPanelBridge } from '@/features/teams/sub_mastermind/lib/useCanvasPanelBridge';
import { lazyRetry } from '@/lib/lazyRetry';
import { renderSectionRoute, isRoutableSection, isSectionGated } from '@/features/personas/sectionRouter';
import { prefetchSection } from '@/features/shared/chrome/navPrefetch';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { silentCatch } from '@/lib/silentCatch';
import { SectionProfiler } from '@/lib/devlog/SectionProfiler';

// Section PRIMARIES (Home, Overview, Teams canvas, Agents table, Events,
// Connections, Templates, Plugins browse, Studio, Settings) are registry-driven
// and lazy-loaded in `sectionRouter.tsx`, mounted here via `renderSectionRoute`.
// Only the sub-tab / editor / build surfaces that compose AROUND those
// primaries are declared below.
//
// lazyRetry (NOT raw React.lazy): it retries a failed chunk fetch once
// (dev-server restart, post-deploy stale chunk), then keeps ONE stable lazy
// instance so a permanent failure reaches the ErrorBoundary's "Reload app"
// cure instead of re-suspending forever. See the lazyRetry docstring.
const PersonaEditor = lazyRetry(() => import('@/features/agents/sub_editor').then(m => ({ default: m.PersonaEditor })));
const CreatePersonaEntry = lazyRetry(() => import('@/features/personas/sub_foundry').then(m => ({ default: m.CreatePersonaEntry })));
// Mid-build resume renders the build progress surface directly (not the
// create-mode chooser) — a session in flight already picked its path.
const UnifiedBuildEntry = lazyRetry(() => import('@/features/agents/components/matrix/UnifiedBuildEntry').then(m => ({ default: m.UnifiedBuildEntry })));
const GoalsPage = lazyRetry(() => import('@/features/teams/sub_goals/GoalsPage'));
const KPIsPage = lazyRetry(() => import('@/features/teams/sub_kpis/KPIsPage'));
const FactoryPage = lazyRetry(() => import('@/features/teams/sub_factory/FactoryPage'));
const ProjectManagerPage = lazyRetry(() => import('@/features/plugins/dev-tools/sub_projects/ProjectManagerPage'));
const LifecyclePage = lazyRetry(() => import('@/features/plugins/dev-tools/sub_lifecycle/LifecyclePage'));
const ContestPage = lazyRetry(() => import('@/features/plugins/dev-tools/contest/ContestPage'));
const MastermindPage = lazyRetry(() => import('@/features/teams/sub_mastermind/MastermindPage'));
const FeaturesPage = lazyRetry(() => import('@/features/teams/sub_features/FeaturesPage'));
const WhitelistPage = lazyRetry(() => import('@/features/browser/whitelist/WhitelistPage'));
const WebviewPage = lazyRetry(() => import('@/features/browser/webview/WebviewPage'));
const CloudDeployPanel = lazyRetry(() => import('@/features/agents/sub_deployment/components/cloud/CloudDeployPanel'));
const GitLabPanel = lazyRetry(() => import('@/features/plugins/gitlab/components/GitLabPanel'));
const UnifiedDeploymentDashboard = lazyRetry(() => import('@/features/agents/sub_deployment/components/UnifiedDeploymentDashboard'));
const DevToolsPage = lazyRetry(() => import('@/features/plugins/dev-tools/DevToolsPage'));
const ObsidianBrainPage = lazyRetry(() => import('@/features/plugins/obsidian-brain/ObsidianBrainPage'));
const DrivePage = lazyRetry(() => import('@/features/plugins/drive/DrivePage'));
const TwinPage = lazyRetry(() => import('@/features/plugins/twin/TwinPage'));
const ScraperPage = lazyRetry(() => import('@/features/scraper/ScraperPage'));

// Every Suspense boundary below falls back to RESERVED SPACE, not a ghost.
//
// 2026-10-05. These boundaries used `RouteChunkSkeleton`, which is invisible for
// 150ms and then draws a calm header ghost. For a WARM chunk that is correct and
// paints nothing. But most sections here are cold on first navigation and resolve
// well past 150ms, so the common case was: ghost header appears, real
// `ContentHeader` replaces it. Two headers in sequence at the same position is
// the skeleton -> content blink the loading doctrine forbids
// (`docs/design/overview-loading.md`), and the owner reported it as such.
//
// A bare `null` fallback is not the fix either - that was the state before the
// skeleton, and because the motion wrapper that used to fade content in is
// disabled (see the content area below), a cold chunk collapsed the content area
// to zero height and the whole page jumped when it resolved.
//
// So the fallback holds the chunk's geometry and paints nothing at all. No ghost
// to replace, no collapse to recover from. `RouteChunkSkeleton` itself is
// unchanged and still correct for the surfaces that mount it under permanent
// chrome, where there is no second header to blink against.
const ROUTE_CHUNK_FALLBACK = <div aria-hidden="true" className="flex-1 min-h-0" />;

// Dev-only startup-phase attribution for the freeze watchdog. Mirrors the
// markPhase helper in App.tsx: the data waves below are the prime suspects for
// the data-volume-dependent startup freeze ("lags more as it grows"), so we
// stamp lastAction before each wave to localize a stall to fetch vs render.
let _markAction: ((s: string) => void) | null = null;
if (import.meta.env.DEV) {
  void import('@/lib/debug/freezeWatchdog').then((m) => { _markAction = m.markAction; });
}
function markStartupPhase(phase: string): void {
  if (!import.meta.env.DEV) return;
  performance.mark(`appInit:${phase}`);
  _markAction?.(phase);
}

export default function PersonasPage() {
  const { shouldAnimate, transition } = useMotion();
  // Always-on bridge: writes Fleet lifecycle events to Athena's
  // episodic memory regardless of which sidebar section is active.
  // Self-sufficient — it refreshes the fleet store on mount and on
  // registry/state events, so it records without the Fleet tab ever opening.
  useAthenaFleetBridge();
  // Same lifetime as the Fleet bridge: subscribes to MCP guidance /
  // approval requests from claude sessions so the chat panel can
  // render them inline (Direction 3).
  useMcpRequestBridge();
  // D7 — subscribes to `athena://orchestration/digest-changed` and
  // populates the operative-memory store the LiveOpsStrip reads.
  useOperativeMemoryBridge();
  // WP3 — `compose_canvas_panel`: persists Athena's composed panel into the
  // canvas layout doc, then routes to Teams → Mastermind and focuses the
  // island. App-wide so a composition lands wherever the user is standing.
  useCanvasPanelBridge();
  // WP4 — `canvas_control`: routes to the canvas, dispatches Athena's steering
  // action into the canvas action grammar, and reports the settled result back
  // into her session. App-wide for the same reason as the panel bridge.
  useCanvasControlBridge();
  const { sidebarSection, cloudTab, agentTab, teamsTab, pluginTab, isCreatingPersona, isLoading, error } = useSystemStore(
    useShallow((s) => ({
      sidebarSection: s.sidebarSection,
      cloudTab: s.cloudTab,
      agentTab: s.agentTab,
      teamsTab: s.teamsTab,
      pluginTab: s.pluginTab,
      isCreatingPersona: s.isCreatingPersona,
      isLoading: s.isLoading,
      error: s.error,
    }))
  );
  const setError = useSystemStore((s) => s.setError);
  // Host-provided "Go to dashboard" recovery for section ErrorBoundaries (the
  // boundary itself is store-free; the shell wires navigation).
  const goHome = () => useSystemStore.getState().setSidebarSection('home');
  const tier = useTier();
  const { selectedPersonaId, personas } = useAgentStore(
    useShallow((s) => ({ selectedPersonaId: s.selectedPersonaId, personas: s.personas }))
  );
  const fetchPersonas = useAgentStore((s) => s.fetchPersonas);
  const fetchToolDefinitions = useAgentStore((s) => s.fetchToolDefinitions);
  const fetchDetail = useAgentStore((s) => s.fetchDetail);


  // True only after fetchPersonas has settled (success or fail).
  // Prevents showing UnifiedBuildEntry before the first load completes.
  const [personasFetched, setPersonasFetched] = useState(false);

  // ONE fan-out at mount, not two awaited waves.
  //
  // What this is NOT: a speed-up. `invokeWithTimeout` has no concurrency
  // limiter and folds duplicate concurrent reads into one round-trip
  // (`tauriInvoke.ts:161`, 250ms post-settle TTL), and the repo's own nav-walk
  // harness recorded 1,406 ms of summed IPC inside a 1,321 ms wall-clock
  // window — these calls genuinely overlap, so settling over N costs
  // max(latency), not sum(latency). Starting them together does not make
  // startup finish sooner.
  //
  // What it IS: time-to-first-useful-paint. Previously four stores' data
  // queued behind the personas round-trip plus a 100 ms yield, so a surface
  // that reads credentials / recipes / teams could not retire its own
  // placeholder until a fetch it never reads had come back. The shell now
  // awaits only what decides WHAT to render; everything else is a prewarm
  // that lets each region paint when its own data lands.
  const runStartup = useCallback(async () => {
    setError(null);

    markStartupPhase('data:fanout');
    const personasFetch = fetchPersonas();
    // Prewarms. Nothing in this shell's router reads any of them, and the
    // landing section is persisted (`uiSlice.ts:423` defaults to `home`), so
    // on most cold starts these four were filling stores for a surface that
    // was not even mounted while they waited behind wave 1.
    const prewarm: ReadonlyArray<readonly [string, Promise<unknown>]> = [
      ['tools', fetchToolDefinitions()],
      ['credentials', import("@/stores/vaultStore").then(m => m.useVaultStore.getState().fetchCredentials())],
      ['recipes', import("@/stores/pipelineStore").then(m => m.usePipelineStore.getState().fetchRecipes())],
      ['teams', import("@/stores/pipelineStore").then(m => m.usePipelineStore.getState().fetchTeams())],
    ];
    // Subscribe in THIS turn: the await below suspends, and a prewarm that
    // rejects before `allSettled` has attached would be an unhandled rejection.
    const settled = Promise.allSettled([personasFetch, ...prewarm.map(([, p]) => p)]);

    // The shell awaits exactly ONE fetch. `fetchPersonas` is the only startup
    // call that decides WHAT to render: `personasFetched` gates the
    // CreatePersonaEntry empty state below, and showing that wizard to an
    // operator who already has agents is a wrong screen, not a late one.
    // Nothing else queues behind this await any more.
    await personasFetch.catch(silentCatch('PersonasPage:fetchPersonas'));
    setPersonasFetched(true);
    markStartupPhase('data:personas-settled');

    // Error banner only — an error surface, not frame-1 content, so it is
    // allowed to arrive when the slowest prewarm settles.
    const results = await settled;
    const labels = ['personas', ...prewarm.map(([name]) => name)];
    const failed = labels.filter((_, i) => results[i]?.status === 'rejected');
    if (failed.length > 0) {
      setError(`Startup failed -- ${failed.join(', ')} could not be loaded`);
    }
    markStartupPhase('data:settled');
    // Auto-reconnect GitLab if a vault credential exists (non-blocking).
    // DELIBERATELY still last, and deliberately NOT chained to the credentials
    // prewarm alone: `gitlabSlice.ts:185` reads the vault credentials through
    // the store bus, and `:187` silently SKIPS auto-connect when that accessor
    // is not registered yet (storeBusWiring loads async). "After everything
    // settles" satisfies both conditions; "after credentials settle" satisfies
    // only the first. So this one keeps the ordering it had.
    void useSystemStore.getState().gitlabInitialize();
  }, [fetchPersonas, fetchToolDefinitions, setError]);

  useEffect(() => {
    runStartup();
  }, [runStartup]);

  // Hydrate persisted persona selection on app restart
  useEffect(() => {
    if (selectedPersonaId) {
      fetchDetail(selectedPersonaId).catch(silentCatch('PersonasPage:fetchDetail'));
    }
  }, [fetchDetail, selectedPersonaId]);

  // Prefetch likely next routes once the shell has mounted.
  // Speculative -- drained one chunk per idle slice (see idlePrefetch) so the
  // route chunks don't evaluate in a burst alongside the overlay prefetch and
  // first-load work. Section primaries go through `prefetchSection`, the same
  // deduped entry the rail's hover prefetch uses, so a chunk warmed by either
  // path is fetched once. Ordered by predicted use: the agent loop first (the
  // Agents list, then the editor it opens), then the dashboards and the daily
  // sections, then the rarer primaries, then the Projects sub-tabs with
  // FactoryPage last (broadest module graph). Failures are logged, not shown.
  //
  // This effect used to open with `if (!personasFetched) return;`, and that
  // dependency was incidental, not real. Chunk prefetch is `import()`
  // resolution — pure main-thread work with no relationship to persona data.
  // The one thing it must not do is evaluate chunks while the first content
  // paint is still happening, and `initialDelayMs: 1500` is what guarantees
  // that; the gate added the personas IPC latency on top of it on every cold
  // start, and dragged the Projects prewarm below along for the same ride.
  // Both timers are now anchored to mount, which is what their comments
  // always claimed.
  useEffect(() => {
    const cancelPrefetch = idlePrefetch([
      () => prefetchSection('personas') ?? Promise.resolve(),
      () => import('@/features/agents/sub_editor'),
      () => prefetchSection('overview') ?? Promise.resolve(),
      () => prefetchSection('home') ?? Promise.resolve(),
      () => prefetchSection('events') ?? Promise.resolve(),
      () => prefetchSection('credentials') ?? Promise.resolve(),
      () => prefetchSection('teams') ?? Promise.resolve(),
      () => prefetchSection('companions') ?? Promise.resolve(),
      () => prefetchSection('design-reviews') ?? Promise.resolve(),
      () => prefetchSection('settings') ?? Promise.resolve(),
      () => prefetchSection('plugins') ?? Promise.resolve(),
      () => prefetchSection('studio') ?? Promise.resolve(),
      // Cloud is dev-only (gated in AgentsSidebarNav), so, like Competition
      // below, its chunk is not worth a production user's bandwidth.
      ...(import.meta.env.DEV
        ? [() => import('@/features/agents/sub_deployment/components/cloud/CloudDeployPanel')]
        : []),
      // Projects (teams) submodule primaries — previously un-prefetched, so a
      // cold first-open paid full chunk fetch+eval behind the route skeleton.
      () => import('@/features/teams/sub_goals/GoalsPage'),
      () => import('@/features/teams/sub_kpis/KPIsPage'),
      () => import('@/features/plugins/dev-tools/sub_projects/ProjectManagerPage'),
      () => import('@/features/plugins/dev-tools/sub_lifecycle/LifecyclePage'),
      () => import('@/features/teams/sub_factory/FactoryPage'),
    ], { initialDelayMs: 1500 });
    // Warm the projects list once, off the startup critical path. Every
    // dev-tools Projects submodule (Manage / Lifecycle / Contest / Factory)
    // and the Goals/KPIs shells gate their first paint on it, and it is not in
    // the runStartup fan-out. Kept as a separate delayed call rather than
    // folded into that fan-out: its own comment states the separation is
    // deliberate, and nothing in this repo has measured a seventh concurrent
    // startup call, so the conservative reading wins. The delay is now
    // measured from mount instead of from the personas round-trip, so the
    // fan-out it is staying clear of has had the full 2 s to settle.
    const projectsWarm = setTimeout(() => {
      void useSystemStore.getState().fetchProjects?.().catch(silentCatch('PersonasPage:prewarmProjects'));
    }, 2000);
    return () => {
      cancelPrefetch();
      clearTimeout(projectsWarm);
    };
  }, []);

  // Auto-resume active build when returning to personas from another section.
  // Uses a ref to prevent the infinite loop: only resumes ONCE per navigation event.
  const buildPersonaId = useAgentStore((s) => s.buildPersonaId);
  const buildPhase = useAgentStore((s) => s.buildPhase);
  const hasActiveBuild = !!buildPersonaId && buildPhase !== 'initializing' && buildPhase !== 'promoted' && buildPhase !== 'failed' && buildPhase !== 'cancelled';
  const prevSectionRef = useRef(sidebarSection);


  useEffect(() => {
    const wasElsewhere = prevSectionRef.current !== 'personas';
    prevSectionRef.current = sidebarSection;
    // Only auto-resume when ARRIVING at personas from another section with an active build
    if (sidebarSection === 'personas' && wasElsewhere && hasActiveBuild && !isCreatingPersona) {
      useSystemStore.getState().setIsCreatingPersona(true);
    }
  }, [sidebarSection, hasActiveBuild, isCreatingPersona]);

  const renderContent = () => {
    // Uniform gate check (Direction 3) — the ONE place tier + dev gating is
    // decided for the content router, mirroring the sidebar rail and command
    // palette. A section whose gates fail (downgraded tier, non-dev build)
    // renders Home immediately instead of briefly mounting a forbidden surface
    // before the Sidebar redirect effect fires. Overlay-only sections have no
    // router branch, so they fall through to the persona default below.
    if (isSectionGated(sidebarSection, { isDev: import.meta.env.DEV, isTierVisible: tier.isVisible })) {
      return renderSectionRoute('home', goHome);
    }

    // Show unified wizard when no personas exist OR when explicitly creating
    if (sidebarSection === 'personas') {
      // Cloud sub-view (dev-only, gated in sidebar)
      if (agentTab === 'cloud') {
        return (
          <ErrorBoundary onGoHome={goHome} name="Cloud">
            <Suspense fallback={ROUTE_CHUNK_FALLBACK}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={cloudTab}
                  initial={{ opacity: 0, x: shouldAnimate ? (cloudTab === 'gitlab' ? 14 : -14) : 0 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: shouldAnimate ? (cloudTab === 'gitlab' ? -14 : 14) : 0 }}
                  transition={transition}
                  className="h-full w-full"
                >
                  {cloudTab === 'unified' ? (
                    <UnifiedDeploymentDashboard />
                  ) : cloudTab === 'gitlab' ? (
                    <GitLabPanel />
                  ) : (
                    <CloudDeployPanel />
                  )}
                </motion.div>
              </AnimatePresence>
            </Suspense>
          </ErrorBoundary>
        );
      }
      // Groups→Teams consolidation (Phase 4): the standalone Groups manager
      // is retired — a team is now the workspace. Any lingering
      // agentTab==='groups' falls through to the default Agents view.
      // Foundry-first create surface (compose from archetype + recipes,
      // describe-it chat, or jump to templates) — the two-layer
      // architecture made visible at the front door.
      if (personasFetched && !isLoading && !error && personas.length === 0) {
        return <ErrorBoundary onGoHome={goHome} name="CreatePersonaEntry"><Suspense fallback={ROUTE_CHUNK_FALLBACK}><CreatePersonaEntry /></Suspense></ErrorBoundary>;
      }
      if (isCreatingPersona) {
        return <ErrorBoundary onGoHome={goHome} name="CreatePersonaEntry"><Suspense fallback={ROUTE_CHUNK_FALLBACK}><CreatePersonaEntry /></Suspense></ErrorBoundary>;
      }
    }

    if (sidebarSection === 'teams') {
      // Teams 1st-level section: Workspace (canvas/Studio), Goals, KPIs, or Factory.
      // Each tab is its own lazy chunk behind the shared delayed header ghost.
      if (teamsTab === 'factory') {
        return <ErrorBoundary onGoHome={goHome} name="Factory"><Suspense fallback={ROUTE_CHUNK_FALLBACK}><FactoryPage /></Suspense></ErrorBoundary>;
      }
      if (teamsTab === 'kpis') {
        return <ErrorBoundary onGoHome={goHome} name="KPIs"><Suspense fallback={ROUTE_CHUNK_FALLBACK}><KPIsPage /></Suspense></ErrorBoundary>;
      }
      if (teamsTab === 'goals') {
        return <ErrorBoundary onGoHome={goHome} name="Goals"><Suspense fallback={ROUTE_CHUNK_FALLBACK}><GoalsPage /></Suspense></ErrorBoundary>;
      }
      if (teamsTab === 'projects') {
        return <ErrorBoundary onGoHome={goHome} name="Projects"><Suspense fallback={ROUTE_CHUNK_FALLBACK}><ProjectManagerPage /></Suspense></ErrorBoundary>;
      }
      if (teamsTab === 'lifecycle') {
        return <ErrorBoundary onGoHome={goHome} name="Lifecycle"><Suspense fallback={ROUTE_CHUNK_FALLBACK}><LifecyclePage /></Suspense></ErrorBoundary>;
      }
      // Contest — the in-app home for the /contest method (setup, seats in
      // the fleet queue, gallery review). Took over the retired Competition
      // slot on 2026-09-24; a persisted `teamsTab: 'competition'` from an
      // older build no longer matches any branch and falls through to the
      // section's landing route below.
      if (teamsTab === 'contest') {
        return <ErrorBoundary onGoHome={goHome} name="Contest"><Suspense fallback={ROUTE_CHUNK_FALLBACK}><ContestPage /></Suspense></ErrorBoundary>;
      }
      if (teamsTab === 'features') {
        return <ErrorBoundary onGoHome={goHome} name="Features"><Suspense fallback={ROUTE_CHUNK_FALLBACK}><FeaturesPage /></Suspense></ErrorBoundary>;
      }
      if (teamsTab === 'mastermind') {
        // Mastermind has no page header, so the header-band ghost matched nothing
        // and blinked into a full-bleed canvas. Its fallback is the canvas frame
        // itself (the page root's own geometry), empty until the chunk lands.
        return <ErrorBoundary onGoHome={goHome} name="Mastermind"><Suspense fallback={<div aria-hidden className="relative h-[calc(100dvh-120px)] min-h-[480px] rounded-card border border-primary/[0.08]" />}><MastermindPage /></Suspense></ErrorBoundary>;
      }
      // Browser group (agent web-app control): the Whitelist gate and the
      // embedded Webview. See docs/features/browser.md.
      if (teamsTab === 'whitelist') {
        return <ErrorBoundary onGoHome={goHome} name="Whitelist"><Suspense fallback={ROUTE_CHUNK_FALLBACK}><WhitelistPage /></Suspense></ErrorBoundary>;
      }
      if (teamsTab === 'webview') {
        return <ErrorBoundary onGoHome={goHome} name="Webview"><Suspense fallback={ROUTE_CHUNK_FALLBACK}><WebviewPage /></Suspense></ErrorBoundary>;
      }
      return renderSectionRoute('teams', goHome);
    }
    if (sidebarSection === 'plugins') {
      // Each plugin primary is a separate lazy chunk (not idle-prefetched) behind
      // the shared delayed header ghost, so a cold first-open never flashes blank.
      if (pluginTab === 'dev-tools') {
        return <ErrorBoundary onGoHome={goHome} name="DevTools"><Suspense fallback={ROUTE_CHUNK_FALLBACK}><DevToolsPage /></Suspense></ErrorBoundary>;
      }
      if (pluginTab === 'obsidian-brain') {
        return <ErrorBoundary onGoHome={goHome} name="ObsidianBrain"><Suspense fallback={ROUTE_CHUNK_FALLBACK}><ObsidianBrainPage /></Suspense></ErrorBoundary>;
      }
      if (pluginTab === 'drive') {
        return <ErrorBoundary onGoHome={goHome} name="Drive"><Suspense fallback={ROUTE_CHUNK_FALLBACK}><DrivePage /></Suspense></ErrorBoundary>;
      }
      if (pluginTab === 'twin') {
        return <ErrorBoundary onGoHome={goHome} name="Twin"><Suspense fallback={ROUTE_CHUNK_FALLBACK}><TwinPage /></Suspense></ErrorBoundary>;
      }
      if (pluginTab === 'scraper' && import.meta.env.DEV) {
        return <ErrorBoundary onGoHome={goHome} name="Scraper"><Suspense fallback={ROUTE_CHUNK_FALLBACK}><ScraperPage /></Suspense></ErrorBoundary>;
      }
      // Browse view — plugin cards with enable/disable toggles
      return renderSectionRoute('plugins', goHome);
    }
    if (sidebarSection === 'companions') {
      // Companions routes on ONE persisted page field, so its primary is a
      // switch rather than a tab ladder here (see `CompanionsPage`). The
      // router's default skeleton covers THIS chunk's cold fetch; each
      // destination inside it carries its own.
      return renderSectionRoute('companions', goHome);
    }
    // Leaf sections — registry-driven primary surface. Gates were already
    // checked above; personas/teams/plugins are handled by their bespoke
    // branches, so anything routable reaching here (home, overview,
    // credentials, events, design-reviews, studio, settings) renders directly.
    // `schedules` is overlay-only (no route) and falls through to the persona
    // default below alongside the persona editor/build surfaces.
    if (isRoutableSection(sidebarSection) && sidebarSection !== 'personas') {
      return renderSectionRoute(sidebarSection, goHome);
    }
    if (selectedPersonaId && buildPersonaId === selectedPersonaId && buildPhase && buildPhase !== 'promoted') {
      return <ErrorBoundary onGoHome={goHome} name="UnifiedBuildEntry"><Suspense fallback={ROUTE_CHUNK_FALLBACK}><UnifiedBuildEntry /></Suspense></ErrorBoundary>;
    }
    if (selectedPersonaId) return <ErrorBoundary onGoHome={goHome} name="Agent Editor"><Suspense fallback={ROUTE_CHUNK_FALLBACK}><PersonaEditor /></Suspense></ErrorBoundary>;
    // Default: All Agents table view (registry primary for the personas section)
    return renderSectionRoute('personas', goHome);
  };

  return (
    <CredentialNavProvider>
      <div className="flex flex-col h-full w-full min-w-0 bg-background text-foreground overflow-hidden" style={{ contain: 'layout style' }}>
        {/* Background effects — blur removed (causes WebView2 compositor freeze on ARM64).
            transform-gpu + backface-hidden isolate each layer onto its own GPU
            texture so it rasters ONCE. Without isolation these full-screen layers
            share a paint layer with hover-repainting content, so every pointer-move
            re-rasterizes the 1px grid gradient — and at fractional Windows DPI
            (125%/150%) a CSS 1px line maps to non-integer device pixels, so each
            re-raster shimmers, most visibly as a flickering seam at the top/right
            edges. Isolation is a lightweight 2D layer promotion, unlike the
            backdrop-blur removed above. */}
        <div className="absolute inset-0 transform-gpu backface-hidden bg-[linear-gradient(rgba(59,130,246,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.03)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none" />
        <div className="absolute inset-0 transform-gpu backface-hidden bg-gradient-to-b from-background/0 via-background/0 to-background/80 pointer-events-none" />

        {/* Main layout */}
        <div className="relative z-10 flex flex-1 overflow-hidden">
          <Sidebar />

          {/* Content area */}
          <div id="main-content" role="main" className={`flex-1 flex flex-col ${IS_MOBILE ? 'overflow-x-hidden' : 'overflow-x-auto'} overflow-y-hidden ${IS_MOBILE ? '' : 'pb-8'}`}>
            {error && (
              <ErrorBanner
                message={error}
                variant="banner"
                onRetry={runStartup}
                onDismiss={() => setError(null)}
              />
            )}
            {/* AnimatePresence disabled — testing if framer-motion layout measurement causes freeze */}
            <div className="flex-1 flex flex-col w-full min-w-0 overflow-y-hidden">
              {/* DEV-only Profiler: slow commits of the active section reach
                  devlog as `commit` records keyed by section id. */}
              <SectionProfiler id={sidebarSection}>{renderContent()}</SectionProfiler>
            </div>
          </div>
        </div>

        {/* Desktop footer bar */}
        <DesktopFooter />
      </div>
    </CredentialNavProvider>
  );
}
