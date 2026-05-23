import { silentCatch } from "@/lib/silentCatch";
import { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { motion, AnimatePresence } from 'framer-motion';

import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
import Sidebar from '@/features/app-shell/components/Sidebar';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import { CredentialNavProvider } from '@/features/vault/shared/hooks/CredentialNavContext';
import { ErrorBanner } from '@/features/shared/components/feedback/ErrorBanner';
import { ErrorBoundary } from '@/features/shared/components/feedback/ErrorBoundary';
import { CanvasDragProvider } from '@/features/pipeline/sub_canvas';
import DesktopFooter from '@/features/shared/components/layout/DesktopFooter';
import { useFleetCompanionBridge } from '@/features/plugins/companion/useFleetCompanionBridge';
import { useMcpRequestBridge } from '@/features/plugins/companion/mcp/useMcpRequestBridge';
import { useOperativeMemoryBridge } from '@/features/plugins/companion/orchestration/useOperativeMemoryBridge';

// Lazy-load all section content — only Sidebar stays eager (always visible)
const HomePage = lazy(() => import('@/features/home/components/HomePage'));
const PersonaEditor = lazy(() => import('@/features/agents/sub_editor').then(m => ({ default: m.PersonaEditor })));
const PersonaOverviewPage = lazy(() => import('@/features/agents/components/allPersonas/PersonaOverviewPage'));
const UnifiedBuildEntry = lazy(() => import('@/features/agents/components/matrix/UnifiedBuildEntry').then(m => ({ default: m.UnifiedBuildEntry })));
const GoalPlannerPanel = lazy(() => import('@/features/agents/sub_planner').then(m => ({ default: m.GoalPlannerPanel })));
const OverviewPage = lazy(() => import('@/features/overview/components/dashboard/OverviewPage'));
const CredentialManager = lazy(() => import('@/features/vault/sub_credentials/manager/CredentialManager').then(m => ({ default: m.CredentialManager })));
const TeamCanvas = lazy(() => import('@/features/pipeline/components/TeamCanvas'));
const GroupManagerPage = lazy(() => import('@/features/pipeline/components/groups/GroupManagerPage'));
const DesignReviewsPage = lazy(() => import('@/features/templates/components/DesignReviewsPage'));
const SettingsPage = lazy(() => import('@/features/settings/components/SettingsPage'));
const TriggersPage = lazy(() => import('@/features/triggers/TriggersPage').then(m => ({ default: m.TriggersPage })));
const CloudDeployPanel = lazy(() => import('@/features/deployment/components/cloud/CloudDeployPanel'));
const GitLabPanel = lazy(() => import('@/features/plugins/gitlab/components/GitLabPanel'));
const UnifiedDeploymentDashboard = lazy(() => import('@/features/deployment/components/UnifiedDeploymentDashboard'));
const DevToolsPage = lazy(() => import('@/features/plugins/dev-tools/DevToolsPage'));
const ArtistPage = lazy(() => import('@/features/plugins/artist/ArtistPage'));
const ObsidianBrainPage = lazy(() => import('@/features/plugins/obsidian-brain/ObsidianBrainPage'));
const ResearchLabPage = lazy(() => import('@/features/plugins/research-lab/ResearchLabPage'));
const DrivePage = lazy(() => import('@/features/plugins/drive/DrivePage'));
const TwinPage = lazy(() => import('@/features/plugins/twin/TwinPage'));
const CompanionPluginPage = lazy(() => import('@/features/plugins/companion/CompanionPluginPage'));
const LangfusePage = lazy(() => import('@/features/plugins/langfuse/LangfusePage'));
const PluginBrowsePage = lazy(() => import('@/features/plugins/PluginBrowsePage'));
const SchedulesPage = lazy(() => import('@/features/schedules/components/ScheduleTimeline'));

// Shared Suspense fallback — null (content fades in via motion.div wrapper)
const SectionFallback = null;

export default function PersonasPage() {
  const { shouldAnimate, transition } = useMotion();
  // Always-on bridge: writes Fleet lifecycle events to Athena's
  // episodic memory regardless of which sidebar section is active.
  // No-op when no fleet sessions exist.
  useFleetCompanionBridge();
  // Same lifetime as the Fleet bridge: subscribes to MCP guidance /
  // approval requests from claude sessions so the chat panel can
  // render them inline (Direction 3).
  useMcpRequestBridge();
  // D7 — subscribes to `athena://orchestration/digest-changed` and
  // populates the operative-memory store the LiveOpsStrip reads.
  useOperativeMemoryBridge();
  const { sidebarSection, cloudTab, agentTab, pluginTab, isCreatingPersona, isLoading, error } = useSystemStore(
    useShallow((s) => ({
      sidebarSection: s.sidebarSection,
      cloudTab: s.cloudTab,
      agentTab: s.agentTab,
      pluginTab: s.pluginTab,
      isCreatingPersona: s.isCreatingPersona,
      isLoading: s.isLoading,
      error: s.error,
    }))
  );
  const setError = useSystemStore((s) => s.setError);
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
    try {
      await fetchPersonas();
    } catch {
      failed.push('personas');
    }
    setPersonasFetched(true);

    // Yield to browser — let React paint before loading secondary data
    await new Promise(r => setTimeout(r, 100));

    // Wave 2: Secondary data — single-mode app loads the full set.
    const secondaryResults = await Promise.allSettled([
      fetchToolDefinitions(),
      import("@/stores/vaultStore").then(m => m.useVaultStore.getState().fetchCredentials()),
      import("@/stores/pipelineStore").then(m => m.usePipelineStore.getState().fetchRecipes()),
      import("@/stores/pipelineStore").then(m => m.usePipelineStore.getState().fetchGroups()),
    ]);
    const SECONDARY_LABELS = ['tools', 'credentials', 'recipes', 'groups'] as const;
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
  // Speculative -- fires during browser idle time, failures silently ignored.
  useEffect(() => {
    if (!personasFetched) return;
    const id = requestIdleCallback(() => {
      // Tier 1: most frequently visited sections
      import('@/features/overview/components/dashboard/OverviewPage').catch(silentCatch("PersonasPage:prefetchOverview"));
      import('@/features/vault/sub_credentials/manager/CredentialManager').catch(silentCatch("PersonasPage:prefetchCredentialManager"));
      import('@/features/settings/components/SettingsPage').catch(silentCatch("PersonasPage:prefetchSettings"));
    });
    // Tier 2: prefetch after a short delay so tier 1 chunks land first
    const id2 = requestIdleCallback(() => {
      import('@/features/deployment/components/cloud/CloudDeployPanel').catch(silentCatch("PersonasPage:prefetchCloudDeploy"));
      import('@/features/templates/components/DesignReviewsPage').catch(silentCatch("PersonasPage:prefetchDesignReviews"));
      import('@/features/triggers/TriggersPage').catch(silentCatch("PersonasPage:prefetchEvents"));
    });
    return () => {
      cancelIdleCallback(id);
      cancelIdleCallback(id2);
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
    // Show unified wizard when no personas exist OR when explicitly creating
    if (sidebarSection === 'personas') {
      // Cloud sub-view (dev-only, gated in sidebar)
      if (agentTab === 'cloud') {
        return (
          <ErrorBoundary name="Cloud">
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
      // Teams sub-view (tier-gated in sidebar — TIERS.TEAM)
      if (agentTab === 'team') {
        return <ErrorBoundary name="Teams"><Suspense fallback={SectionFallback}><TeamCanvas /></Suspense></ErrorBoundary>;
      }
      // Groups manager (tier-gated alongside Teams)
      if (agentTab === 'groups') {
        return <ErrorBoundary name="Groups"><Suspense fallback={SectionFallback}><GroupManagerPage /></Suspense></ErrorBoundary>;
      }
      // Goal-to-Plan — read-only narrated planner (idea-ba306c32, Stage 1)
      if (agentTab === 'planner') {
        return <ErrorBoundary name="GoalPlanner"><Suspense fallback={SectionFallback}><GoalPlannerPanel /></Suspense></ErrorBoundary>;
      }
      if (personasFetched && !isLoading && !error && personas.length === 0) {
        return <ErrorBoundary name="UnifiedBuildEntry"><Suspense fallback={SectionFallback}><UnifiedBuildEntry /></Suspense></ErrorBoundary>;
      }
      if (isCreatingPersona) {
        return <ErrorBoundary name="UnifiedBuildEntry"><Suspense fallback={SectionFallback}><UnifiedBuildEntry /></Suspense></ErrorBoundary>;
      }
    }

    if (sidebarSection === 'home') return <ErrorBoundary name="Home"><Suspense fallback={SectionFallback}><HomePage /></Suspense></ErrorBoundary>;
    if (sidebarSection === 'overview') {
      return <ErrorBoundary name="Overview"><Suspense fallback={SectionFallback}><OverviewPage /></Suspense></ErrorBoundary>;
    }
    if (sidebarSection === 'credentials') return <ErrorBoundary name="Vault"><Suspense fallback={SectionFallback}><CredentialManager /></Suspense></ErrorBoundary>;
    if (sidebarSection === 'events') return <ErrorBoundary name="Triggers"><Suspense fallback={SectionFallback}><TriggersPage /></Suspense></ErrorBoundary>;
    if (sidebarSection === 'design-reviews') return <ErrorBoundary name="Design Reviews"><Suspense fallback={SectionFallback}><DesignReviewsPage /></Suspense></ErrorBoundary>;
    if (sidebarSection === 'plugins') {
      if (pluginTab === 'dev-tools') {
        return <ErrorBoundary name="DevTools"><Suspense fallback={SectionFallback}><DevToolsPage /></Suspense></ErrorBoundary>;
      }
      if (pluginTab === 'artist' && import.meta.env.DEV) {
        return <ErrorBoundary name="Artist"><Suspense fallback={SectionFallback}><ArtistPage /></Suspense></ErrorBoundary>;
      }
      if (pluginTab === 'obsidian-brain') {
        return <ErrorBoundary name="ObsidianBrain"><Suspense fallback={SectionFallback}><ObsidianBrainPage /></Suspense></ErrorBoundary>;
      }
      if (pluginTab === 'research-lab' && import.meta.env.DEV) {
        return <ErrorBoundary name="ResearchLab"><Suspense fallback={SectionFallback}><ResearchLabPage /></Suspense></ErrorBoundary>;
      }
      if (pluginTab === 'drive') {
        return <ErrorBoundary name="Drive"><Suspense fallback={SectionFallback}><DrivePage /></Suspense></ErrorBoundary>;
      }
      if (pluginTab === 'twin') {
        return <ErrorBoundary name="Twin"><Suspense fallback={SectionFallback}><TwinPage /></Suspense></ErrorBoundary>;
      }
      if (pluginTab === 'companion') {
        return <ErrorBoundary name="Companion"><Suspense fallback={SectionFallback}><CompanionPluginPage /></Suspense></ErrorBoundary>;
      }
      if (pluginTab === 'langfuse') {
        return <ErrorBoundary name="Langfuse"><Suspense fallback={SectionFallback}><LangfusePage /></Suspense></ErrorBoundary>;
      }
      // Browse view — plugin cards with enable/disable toggles
      return <ErrorBoundary name="PluginBrowse"><Suspense fallback={SectionFallback}><PluginBrowsePage /></Suspense></ErrorBoundary>;
    }
    if (sidebarSection === 'schedules') return <ErrorBoundary name="Schedules"><Suspense fallback={SectionFallback}><SchedulesPage /></Suspense></ErrorBoundary>;
    if (sidebarSection === 'settings') return <ErrorBoundary name="Settings"><Suspense fallback={SectionFallback}><SettingsPage /></Suspense></ErrorBoundary>;
    if (selectedPersonaId && buildPersonaId === selectedPersonaId && buildPhase && buildPhase !== 'promoted') {
      return <ErrorBoundary name="UnifiedBuildEntry"><Suspense fallback={SectionFallback}><UnifiedBuildEntry /></Suspense></ErrorBoundary>;
    }
    if (selectedPersonaId) return <ErrorBoundary name="Agent Editor"><Suspense fallback={SectionFallback}><PersonaEditor /></Suspense></ErrorBoundary>;
    // Default: All Agents table view
    return <ErrorBoundary name="Agent Overview"><Suspense fallback={SectionFallback}><PersonaOverviewPage /></Suspense></ErrorBoundary>;
  };

  return (
    <CanvasDragProvider>
      <CredentialNavProvider>
        <div className="flex flex-col h-full bg-background text-foreground overflow-hidden" style={{ contain: 'layout style' }}>
          {/* Background effects — blur removed (causes WebView2 compositor freeze on ARM64) */}
          <div className="absolute inset-0 bg-[linear-gradient(rgba(59,130,246,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.03)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none" />
          <div className="absolute inset-0 bg-gradient-to-b from-background/0 via-background/0 to-background/80 pointer-events-none" />

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
    </CanvasDragProvider>
  );
}
