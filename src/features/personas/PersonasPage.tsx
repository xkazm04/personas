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
import DesktopFooter from '@/features/shared/chrome/DesktopFooter';
import { useFleetCompanionBridge } from '@/features/plugins/companion/useFleetCompanionBridge';
import { useMcpRequestBridge } from '@/features/plugins/companion/mcp/useMcpRequestBridge';
import { useOperativeMemoryBridge } from '@/features/plugins/companion/orchestration/useOperativeMemoryBridge';
import { lazyRetry } from '@/lib/lazyRetry';
import { renderSectionRoute, isRoutableSection, isSectionGated } from '@/features/personas/sectionRouter';
import { useTier } from '@/hooks/utility/interaction/useTier';

// Section PRIMARIES (Home, Overview, Teams canvas, Agents table, Events,
// Connections, Templates, Plugins browse, Studio, Settings) are registry-driven
// and lazy-loaded in `sectionRouter.tsx`, mounted here via `renderSectionRoute`.
// Only the sub-tab / editor / build surfaces that compose AROUND those
// primaries are declared below.
//
// lazyRetry (NOT raw React.lazy): raw lazy caches a rejected import promise
// forever, so one failed chunk fetch (dev-server restart, post-deploy stale
// chunk) bricked the section until a full page reload — the 2026-06-07
// "infinite rendering" incident. lazyRetry swaps in a fresh lazy instance
// after failure, so the next error-boundary reset / remount re-imports.
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
const CloudDeployPanel = lazyRetry(() => import('@/features/agents/sub_deployment/components/cloud/CloudDeployPanel'));
const GitLabPanel = lazyRetry(() => import('@/features/plugins/gitlab/components/GitLabPanel'));
const UnifiedDeploymentDashboard = lazyRetry(() => import('@/features/agents/sub_deployment/components/UnifiedDeploymentDashboard'));
const DevToolsPage = lazyRetry(() => import('@/features/plugins/dev-tools/DevToolsPage'));
const ArtistPage = lazyRetry(() => import('@/features/plugins/artist/ArtistPage'));
const ObsidianBrainPage = lazyRetry(() => import('@/features/plugins/obsidian-brain/ObsidianBrainPage'));
const ResearchLabPage = lazyRetry(() => import('@/features/plugins/research-lab/ResearchLabPage'));
const DrivePage = lazyRetry(() => import('@/features/plugins/drive/DrivePage'));
const TwinPage = lazyRetry(() => import('@/features/plugins/twin/TwinPage'));
const CompanionPluginPage = lazyRetry(() => import('@/features/plugins/companion/CompanionPluginPage'));
const ScraperPage = lazyRetry(() => import('@/features/scraper/ScraperPage'));

// Shared Suspense fallback — null (content fades in via motion.div wrapper)
const SectionFallback = null;

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
  useFleetCompanionBridge();
  // Same lifetime as the Fleet bridge: subscribes to MCP guidance /
  // approval requests from claude sessions so the chat panel can
  // render them inline (Direction 3).
  useMcpRequestBridge();
  // D7 — subscribes to `athena://orchestration/digest-changed` and
  // populates the operative-memory store the LiveOpsStrip reads.
  useOperativeMemoryBridge();
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
    } catch {
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
      fetchDetail(selectedPersonaId).catch(() => {/* non-critical: persisted selection may be stale */ });
    }
  }, [fetchDetail, selectedPersonaId]);

  // Prefetch likely next routes after initial load settles.
  // Speculative -- drained one chunk per idle slice (see idlePrefetch) so the
  // route chunks don't evaluate in a burst alongside the overlay prefetch and
  // first-load work. Ordered most-frequently-visited first; failures ignored.
  useEffect(() => {
    if (!personasFetched) return;
    return idlePrefetch([
      () => import('@/features/overview/components/dashboard/OverviewPage'),
      () => import('@/features/vault/sub_credentials/manager/CredentialManager'),
      () => import('@/features/settings/components/SettingsPage'),
      () => import('@/features/agents/sub_deployment/components/cloud/CloudDeployPanel'),
      () => import('@/features/templates/components/DesignReviewsPage'),
      () => import('@/features/triggers/TriggersPage'),
    ], { initialDelayMs: 1500 });
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
            <Suspense fallback={SectionFallback}>
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
        return <ErrorBoundary onGoHome={goHome} name="CreatePersonaEntry"><Suspense fallback={SectionFallback}><CreatePersonaEntry /></Suspense></ErrorBoundary>;
      }
      if (isCreatingPersona) {
        return <ErrorBoundary onGoHome={goHome} name="CreatePersonaEntry"><Suspense fallback={SectionFallback}><CreatePersonaEntry /></Suspense></ErrorBoundary>;
      }
    }

    if (sidebarSection === 'teams') {
      // Teams 1st-level section: Workspace (canvas/Studio), Goals, KPIs, or Factory.
      if (teamsTab === 'factory') {
        return <ErrorBoundary onGoHome={goHome} name="Factory"><Suspense fallback={SectionFallback}><FactoryPage /></Suspense></ErrorBoundary>;
      }
      if (teamsTab === 'kpis') {
        return <ErrorBoundary onGoHome={goHome} name="KPIs"><Suspense fallback={SectionFallback}><KPIsPage /></Suspense></ErrorBoundary>;
      }
      if (teamsTab === 'goals') {
        return <ErrorBoundary onGoHome={goHome} name="Goals"><Suspense fallback={SectionFallback}><GoalsPage /></Suspense></ErrorBoundary>;
      }
      if (teamsTab === 'projects') {
        return <ErrorBoundary onGoHome={goHome} name="Projects"><Suspense fallback={SectionFallback}><ProjectManagerPage /></Suspense></ErrorBoundary>;
      }
      if (teamsTab === 'lifecycle') {
        return <ErrorBoundary onGoHome={goHome} name="Lifecycle"><Suspense fallback={SectionFallback}><LifecyclePage /></Suspense></ErrorBoundary>;
      }
      if (teamsTab === 'competition') {
        return <ErrorBoundary onGoHome={goHome} name="Competition"><Suspense fallback={SectionFallback}><CompetitionPage /></Suspense></ErrorBoundary>;
      }
      return renderSectionRoute('teams', goHome);
    }
    if (sidebarSection === 'plugins') {
      if (pluginTab === 'dev-tools') {
        return <ErrorBoundary onGoHome={goHome} name="DevTools"><Suspense fallback={SectionFallback}><DevToolsPage /></Suspense></ErrorBoundary>;
      }
      if (pluginTab === 'artist' && import.meta.env.DEV) {
        return <ErrorBoundary onGoHome={goHome} name="Artist"><Suspense fallback={SectionFallback}><ArtistPage /></Suspense></ErrorBoundary>;
      }
      if (pluginTab === 'obsidian-brain') {
        return <ErrorBoundary onGoHome={goHome} name="ObsidianBrain"><Suspense fallback={SectionFallback}><ObsidianBrainPage /></Suspense></ErrorBoundary>;
      }
      if (pluginTab === 'research-lab' && import.meta.env.DEV) {
        return <ErrorBoundary onGoHome={goHome} name="ResearchLab"><Suspense fallback={SectionFallback}><ResearchLabPage /></Suspense></ErrorBoundary>;
      }
      if (pluginTab === 'drive') {
        return <ErrorBoundary onGoHome={goHome} name="Drive"><Suspense fallback={SectionFallback}><DrivePage /></Suspense></ErrorBoundary>;
      }
      if (pluginTab === 'twin') {
        return <ErrorBoundary onGoHome={goHome} name="Twin"><Suspense fallback={SectionFallback}><TwinPage /></Suspense></ErrorBoundary>;
      }
      if (pluginTab === 'companion') {
        return <ErrorBoundary onGoHome={goHome} name="Companion"><Suspense fallback={SectionFallback}><CompanionPluginPage /></Suspense></ErrorBoundary>;
      }
      if (pluginTab === 'scraper' && import.meta.env.DEV) {
        return <ErrorBoundary onGoHome={goHome} name="Scraper"><Suspense fallback={SectionFallback}><ScraperPage /></Suspense></ErrorBoundary>;
      }
      // Browse view — plugin cards with enable/disable toggles
      return renderSectionRoute('plugins', goHome);
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
      return <ErrorBoundary onGoHome={goHome} name="UnifiedBuildEntry"><Suspense fallback={SectionFallback}><UnifiedBuildEntry /></Suspense></ErrorBoundary>;
    }
    if (selectedPersonaId) return <ErrorBoundary onGoHome={goHome} name="Agent Editor"><Suspense fallback={SectionFallback}><PersonaEditor /></Suspense></ErrorBoundary>;
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
