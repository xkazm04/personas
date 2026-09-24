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
import { RouteChunkSkeleton } from '@/features/shared/components/layout/RouteChunkSkeleton';
import { prefetchSection } from '@/features/shared/chrome/navPrefetch';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { silentCatch } from '@/lib/silentCatch';

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
const CompetitionPage = lazyRetry(() => import('@/features/plugins/dev-tools/sub_lifecycle/CompetitionPage'));
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

// Every Suspense boundary below falls back to `RouteChunkSkeleton`: invisible
// for 150ms (CSS delay), so a warm or prefetched chunk paints nothing, and a
// slow one shows the calm header ghost. A `null` fallback here used to rely on
// a motion wrapper to fade content in, but that wrapper is disabled (see the
// content area below), so a cold chunk showed a blank, collapsed area.

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

  const runStartup = useCallback(async () => {
    // Staggered startup: fetch personas first (critical for first paint),
    // then secondary data in a second wave to avoid IPC stampede.
    setError(null);
    const failed: string[] = [];

    // Wave 1: Personas — needed for initial render
    markStartupPhase('data:personas');
    try {
      await fetchPersonas();
    } catch (err) {
      silentCatch('PersonasPage:fetchPersonas')(err);
      failed.push('personas');
    }
    setPersonasFetched(true);

    // Yield to browser — let React paint before loading secondary data
    await new Promise(r => setTimeout(r, 100));

    // Wave 2: Secondary data — single-mode app loads the full set.
    markStartupPhase('data:secondary');
    const secondaryResults = await Promise.allSettled([
      fetchToolDefinitions(),
      import("@/stores/vaultStore").then(m => m.useVaultStore.getState().fetchCredentials()),
      import("@/stores/pipelineStore").then(m => m.usePipelineStore.getState().fetchRecipes()),
      import("@/stores/pipelineStore").then(m => m.usePipelineStore.getState().fetchTeams()),
    ]);
    const SECONDARY_LABELS = ['tools', 'credentials', 'recipes', 'teams'] as const;
    secondaryResults.forEach((r, i) => {
      if (r.status === 'rejected' && SECONDARY_LABELS[i]) failed.push(SECONDARY_LABELS[i]);
    });

    if (failed.length > 0) {
      setError(`Startup failed -- ${failed.join(', ')} could not be loaded`);
    }
    // Auto-reconnect GitLab if a vault credential exists (non-blocking)
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

  // Prefetch likely next routes after initial load settles.
  // Speculative -- drained one chunk per idle slice (see idlePrefetch) so the
  // route chunks don't evaluate in a burst alongside the overlay prefetch and
  // first-load work. Section primaries go through `prefetchSection`, the same
  // deduped entry the rail's hover prefetch uses, so a chunk warmed by either
  // path is fetched once. Ordered by predicted use: the agent loop first (the
  // Agents list, then the editor it opens), then the dashboards and the daily
  // sections, then the rarer primaries, then the Projects sub-tabs with
  // FactoryPage last (broadest module graph). Failures are logged, not shown.
  useEffect(() => {
    if (!personasFetched) return;
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
      // Competition is dev-only now — prefetching a chunk no production user
      // can reach is bandwidth spent on nothing.
      ...(import.meta.env.DEV
        ? [() => import('@/features/plugins/dev-tools/sub_lifecycle/CompetitionPage')]
        : []),
      () => import('@/features/teams/sub_factory/FactoryPage'),
    ], { initialDelayMs: 1500 });
    // Warm the projects list once, off the startup critical path. Every
    // dev-tools Projects submodule (Manage / Lifecycle / Competition / Factory)
    // and the Goals/KPIs shells gate their first paint on it, and it is not in
    // the runStartup waves. Delayed so it doesn't join the wave-2 IPC stampede;
    // the ghost-under-chrome still covers a click that beats this.
    const projectsWarm = setTimeout(() => {
      void useSystemStore.getState().fetchProjects?.().catch(silentCatch('PersonasPage:prewarmProjects'));
    }, 2000);
    return () => {
      cancelPrefetch();
      clearTimeout(projectsWarm);
    };
  }, [personasFetched]);

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
            <Suspense fallback={<RouteChunkSkeleton />}>
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
        return <ErrorBoundary onGoHome={goHome} name="CreatePersonaEntry"><Suspense fallback={<RouteChunkSkeleton />}><CreatePersonaEntry /></Suspense></ErrorBoundary>;
      }
      if (isCreatingPersona) {
        return <ErrorBoundary onGoHome={goHome} name="CreatePersonaEntry"><Suspense fallback={<RouteChunkSkeleton />}><CreatePersonaEntry /></Suspense></ErrorBoundary>;
      }
    }

    if (sidebarSection === 'teams') {
      // Teams 1st-level section: Workspace (canvas/Studio), Goals, KPIs, or Factory.
      // Each tab is its own lazy chunk behind the shared delayed header ghost.
      if (teamsTab === 'factory') {
        return <ErrorBoundary onGoHome={goHome} name="Factory"><Suspense fallback={<RouteChunkSkeleton />}><FactoryPage /></Suspense></ErrorBoundary>;
      }
      if (teamsTab === 'kpis') {
        return <ErrorBoundary onGoHome={goHome} name="KPIs"><Suspense fallback={<RouteChunkSkeleton />}><KPIsPage /></Suspense></ErrorBoundary>;
      }
      if (teamsTab === 'goals') {
        return <ErrorBoundary onGoHome={goHome} name="Goals"><Suspense fallback={<RouteChunkSkeleton />}><GoalsPage /></Suspense></ErrorBoundary>;
      }
      if (teamsTab === 'projects') {
        return <ErrorBoundary onGoHome={goHome} name="Projects"><Suspense fallback={<RouteChunkSkeleton />}><ProjectManagerPage /></Suspense></ErrorBoundary>;
      }
      if (teamsTab === 'lifecycle') {
        return <ErrorBoundary onGoHome={goHome} name="Lifecycle"><Suspense fallback={<RouteChunkSkeleton />}><LifecyclePage /></Suspense></ErrorBoundary>;
      }
      // Competition is EXPERIMENTAL and dev-gated (golden rail in
      // `TeamsSidebarNav`). The nav entry is gone in a production build, but
      // `teamsTab` is persisted — a store written in a dev build would
      // otherwise land a prod user on a route with no way back to it in the
      // menu. Falling through to the section's landing route is the honest
      // reading of "this surface does not exist here".
      if (teamsTab === 'competition' && import.meta.env.DEV) {
        return <ErrorBoundary onGoHome={goHome} name="Competition"><Suspense fallback={<RouteChunkSkeleton />}><CompetitionPage /></Suspense></ErrorBoundary>;
      }
      if (teamsTab === 'features') {
        return <ErrorBoundary onGoHome={goHome} name="Features"><Suspense fallback={<RouteChunkSkeleton />}><FeaturesPage /></Suspense></ErrorBoundary>;
      }
      if (teamsTab === 'mastermind') {
        return <ErrorBoundary onGoHome={goHome} name="Mastermind"><Suspense fallback={<RouteChunkSkeleton />}><MastermindPage /></Suspense></ErrorBoundary>;
      }
      // Browser group (agent web-app control): the Whitelist gate and the
      // embedded Webview. See docs/features/browser.md.
      if (teamsTab === 'whitelist') {
        return <ErrorBoundary onGoHome={goHome} name="Whitelist"><Suspense fallback={<RouteChunkSkeleton />}><WhitelistPage /></Suspense></ErrorBoundary>;
      }
      if (teamsTab === 'webview') {
        return <ErrorBoundary onGoHome={goHome} name="Webview"><Suspense fallback={<RouteChunkSkeleton />}><WebviewPage /></Suspense></ErrorBoundary>;
      }
      return renderSectionRoute('teams', goHome);
    }
    if (sidebarSection === 'plugins') {
      // Each plugin primary is a separate lazy chunk (not idle-prefetched) behind
      // the shared delayed header ghost, so a cold first-open never flashes blank.
      if (pluginTab === 'dev-tools') {
        return <ErrorBoundary onGoHome={goHome} name="DevTools"><Suspense fallback={<RouteChunkSkeleton />}><DevToolsPage /></Suspense></ErrorBoundary>;
      }
      if (pluginTab === 'obsidian-brain') {
        return <ErrorBoundary onGoHome={goHome} name="ObsidianBrain"><Suspense fallback={<RouteChunkSkeleton />}><ObsidianBrainPage /></Suspense></ErrorBoundary>;
      }
      if (pluginTab === 'drive') {
        return <ErrorBoundary onGoHome={goHome} name="Drive"><Suspense fallback={<RouteChunkSkeleton />}><DrivePage /></Suspense></ErrorBoundary>;
      }
      if (pluginTab === 'twin') {
        return <ErrorBoundary onGoHome={goHome} name="Twin"><Suspense fallback={<RouteChunkSkeleton />}><TwinPage /></Suspense></ErrorBoundary>;
      }
      if (pluginTab === 'scraper' && import.meta.env.DEV) {
        return <ErrorBoundary onGoHome={goHome} name="Scraper"><Suspense fallback={<RouteChunkSkeleton />}><ScraperPage /></Suspense></ErrorBoundary>;
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
      return <ErrorBoundary onGoHome={goHome} name="UnifiedBuildEntry"><Suspense fallback={<RouteChunkSkeleton />}><UnifiedBuildEntry /></Suspense></ErrorBoundary>;
    }
    if (selectedPersonaId) return <ErrorBoundary onGoHome={goHome} name="Agent Editor"><Suspense fallback={<RouteChunkSkeleton />}><PersonaEditor /></Suspense></ErrorBoundary>;
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
              {renderContent()}
            </div>
          </div>
        </div>

        {/* Desktop footer bar */}
        <DesktopFooter />
      </div>
    </CredentialNavProvider>
  );
}
