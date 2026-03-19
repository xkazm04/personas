import { silentCatch } from "@/lib/silentCatch";
import { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { motion, AnimatePresence } from 'framer-motion';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
import Sidebar from '@/features/shared/components/layout/sidebar/Sidebar';
import { sections } from '@/features/shared/components/layout/sidebar/sidebarData';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import { CredentialNavProvider } from '@/features/vault/hooks/CredentialNavContext';
import { ErrorBanner } from '@/features/shared/components/feedback/ErrorBanner';
import { ErrorBoundary } from '@/features/shared/components/feedback/ErrorBoundary';
import { CanvasDragProvider } from '@/features/pipeline/sub_canvas';
import DesktopFooter from '@/features/shared/components/layout/DesktopFooter';
import BreadcrumbTrail from '@/features/shared/components/layout/BreadcrumbTrail';

// Lazy-load all section content — only Sidebar stays eager (always visible)
const HomePage = lazy(() => import('@/features/home/components/HomePage'));
const PersonaEditor = lazy(() => import('@/features/agents/sub_editor').then(m => ({ default: m.PersonaEditor })));
const PersonaOverviewPage = lazy(() => import('@/features/agents/components/persona/PersonaOverviewPage'));
const UnifiedMatrixEntry = lazy(() => import('@/features/agents/components/matrix/UnifiedMatrixEntry').then(m => ({ default: m.UnifiedMatrixEntry })));
const OverviewPage = lazy(() => import('@/features/overview/components/dashboard/OverviewPage'));
const CredentialManager = lazy(() => import('@/features/vault/sub_manager/CredentialManager').then(m => ({ default: m.CredentialManager })));
const TeamCanvas = lazy(() => import('@/features/pipeline/components/TeamCanvas'));
const DesignReviewsPage = lazy(() => import('@/features/templates/components/DesignReviewsPage'));
const SettingsPage = lazy(() => import('@/features/settings/components/SettingsPage'));
const EventsPage = lazy(() => import('@/features/triggers/sub_eventbus/EventsPage').then(m => ({ default: m.EventsPage })));
const CloudDeployPanel = lazy(() => import('@/features/deployment/components/cloud/CloudDeployPanel'));
const GitLabPanel = lazy(() => import('@/features/gitlab/components/GitLabPanel'));
const UnifiedDeploymentDashboard = lazy(() => import('@/features/deployment/components/UnifiedDeploymentDashboard'));
const DevToolsPage = lazy(() => import('@/features/dev-tools/DevToolsPage'));
const CompositionEditor = lazy(() => import('@/features/composition/components/CompositionEditor'));

// Shared Suspense fallback — null (content fades in via motion.div wrapper)
const SectionFallback = null;

// Direction-aware cross-fade variants for section switches.
// `custom` receives the navigation direction (1 = down, -1 = up, 0 = no motion).
const sectionFadeVariants = {
  initial: (dir: number) => ({ opacity: 0, y: dir * 12 }),
  animate: { opacity: 1, y: 0 },
  exit: (dir: number) => ({ opacity: 0, y: -dir * 12 }),
};

export default function PersonasPage() {
  const { shouldAnimate, transition } = useMotion();
  const { sidebarSection, cloudTab, isCreatingPersona, isLoading, error } = useSystemStore(
    useShallow((s) => ({
      sidebarSection: s.sidebarSection,
      cloudTab: s.cloudTab,
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
  // Prevents showing UnifiedMatrixEntry before the first load completes.
  const [personasFetched, setPersonasFetched] = useState(false);

  const runStartup = useCallback(() => {
    // Run all startup fetches in parallel and collect failures.
    // Vault and pipeline stores are dynamically imported to keep them out of the main bundle.
    setError(null);
    const STARTUP_LABELS = ['personas', 'tools', 'credentials', 'recipes', 'groups', 'workflows'] as const;
    Promise.allSettled([
      fetchPersonas(),
      fetchToolDefinitions(),
      import("@/stores/vaultStore").then(m => m.useVaultStore.getState().fetchCredentials()),
      import("@/stores/pipelineStore").then(m => m.usePipelineStore.getState().fetchRecipes()),
      import("@/stores/pipelineStore").then(m => m.usePipelineStore.getState().fetchGroups()),
      import("@/stores/pipelineStore").then(m => m.usePipelineStore.getState().fetchWorkflows()),
    ]).then((results) => {
      setPersonasFetched(true);
      const failed = (results as PromiseSettledResult<void>[])
        .map((r, i) => (r.status === 'rejected' ? STARTUP_LABELS[i] : null))
        .filter((l): l is NonNullable<typeof l> => l !== null);
      if (failed.length > 0) {
        setError(`Startup failed -- ${failed.join(', ')} could not be loaded`);
      }
    }).catch(() => {
      setPersonasFetched(true);
    });
  }, [fetchPersonas, fetchToolDefinitions, setError]);

  useEffect(() => {
    runStartup();
  }, [runStartup]);

  // Hydrate persisted persona selection on app restart
  useEffect(() => {
    if (selectedPersonaId) {
      fetchDetail(selectedPersonaId).catch(() => {/* non-critical: persisted selection may be stale */});
    }
  }, []);

  // Prefetch likely next routes after initial load settles.
  // Speculative -- fires during browser idle time, failures silently ignored.
  useEffect(() => {
    if (!personasFetched) return;
    const id = requestIdleCallback(() => {
      // Tier 1: most frequently visited sections
      import('@/features/overview/components/dashboard/OverviewPage').catch(silentCatch("PersonasPage:prefetchOverview"));
      import('@/features/vault/sub_manager/CredentialManager').catch(silentCatch("PersonasPage:prefetchCredentialManager"));
      import('@/features/settings/components/SettingsPage').catch(silentCatch("PersonasPage:prefetchSettings"));
    });
    // Tier 2: prefetch after a short delay so tier 1 chunks land first
    const id2 = requestIdleCallback(() => {
      import('@/features/deployment/components/cloud/CloudDeployPanel').catch(silentCatch("PersonasPage:prefetchCloudDeploy"));
      import('@/features/templates/components/DesignReviewsPage').catch(silentCatch("PersonasPage:prefetchDesignReviews"));
      import('@/features/triggers/sub_eventbus/EventsPage').catch(silentCatch("PersonasPage:prefetchEvents"));
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

  // Direction-aware cross-fade: track section index order for slide direction
  const navSectionRef = useRef(sidebarSection);
  const navDirectionRef = useRef(1);
  if (sidebarSection !== navSectionRef.current) {
    const prevIdx = sections.findIndex(s => s.id === navSectionRef.current);
    const currIdx = sections.findIndex(s => s.id === sidebarSection);
    navDirectionRef.current = currIdx >= prevIdx ? 1 : -1;
    navSectionRef.current = sidebarSection;
  }
  const sectionDir = shouldAnimate ? navDirectionRef.current : 0;
  const sectionTransition = { ...transition, duration: shouldAnimate ? 0.15 : 0.01 };

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
      if (personasFetched && !isLoading && !error && personas.length === 0) {
        return <ErrorBoundary name="UnifiedMatrixEntry"><Suspense fallback={SectionFallback}><UnifiedMatrixEntry /></Suspense></ErrorBoundary>;
      }
      if (isCreatingPersona) {
        return <ErrorBoundary name="UnifiedMatrixEntry"><Suspense fallback={SectionFallback}><UnifiedMatrixEntry canCancel /></Suspense></ErrorBoundary>;
      }
    }

    if (sidebarSection === 'home') return <ErrorBoundary name="Home"><Suspense fallback={SectionFallback}><HomePage /></Suspense></ErrorBoundary>;
    if (sidebarSection === 'workflows') {
      return <ErrorBoundary name="Workflows"><Suspense fallback={SectionFallback}><CompositionEditor /></Suspense></ErrorBoundary>;
    }
    if (sidebarSection === 'team') {
      return <ErrorBoundary name="Teams"><Suspense fallback={SectionFallback}><TeamCanvas /></Suspense></ErrorBoundary>;
    }
    if (sidebarSection === 'cloud') {
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
    if (sidebarSection === 'overview') {
      return <ErrorBoundary name="Overview"><Suspense fallback={SectionFallback}><OverviewPage /></Suspense></ErrorBoundary>;
    }
    if (sidebarSection === 'credentials') return <ErrorBoundary name="Vault"><Suspense fallback={SectionFallback}><CredentialManager /></Suspense></ErrorBoundary>;
    if (sidebarSection === 'events') return <ErrorBoundary name="Triggers"><Suspense fallback={SectionFallback}><EventsPage /></Suspense></ErrorBoundary>;
    if (sidebarSection === 'design-reviews') return <ErrorBoundary name="Design Reviews"><Suspense fallback={SectionFallback}><DesignReviewsPage /></Suspense></ErrorBoundary>;
    if (sidebarSection === 'dev-tools') return <ErrorBoundary name="DevTools"><Suspense fallback={SectionFallback}><DevToolsPage /></Suspense></ErrorBoundary>;
    if (sidebarSection === 'settings') return <ErrorBoundary name="Settings"><Suspense fallback={SectionFallback}><SettingsPage /></Suspense></ErrorBoundary>;
    if (selectedPersonaId && buildPersonaId === selectedPersonaId && buildPhase && buildPhase !== 'promoted') {
      return <ErrorBoundary name="UnifiedMatrixEntry"><Suspense fallback={SectionFallback}><UnifiedMatrixEntry canCancel /></Suspense></ErrorBoundary>;
    }
    if (selectedPersonaId) return <ErrorBoundary name="Agent Editor"><Suspense fallback={SectionFallback}><PersonaEditor /></Suspense></ErrorBoundary>;
    // Default: All Agents table view
    return <ErrorBoundary name="Agent Overview"><Suspense fallback={SectionFallback}><PersonaOverviewPage /></Suspense></ErrorBoundary>;
  };

  return (
    <CanvasDragProvider>
    <CredentialNavProvider>
      <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">
      {/* Background effects matching GoalsLayout */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(59,130,246,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.03)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-b from-background/0 via-background/0 to-background/80 pointer-events-none" />
      <div className="absolute top-0 left-0 w-1/3 h-1/2 bg-accent/5 blur-3xl pointer-events-none" />

      {/* Main layout */}
      <div className="relative z-10 flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <Sidebar />

        {/* Content area */}
        <div id="main-content" role="main" className={`flex-1 flex flex-col ${IS_MOBILE ? 'overflow-x-hidden' : 'overflow-x-auto'} overflow-y-hidden ${IS_MOBILE ? '' : 'pb-8'}`}>
          <BreadcrumbTrail />
          {error && (
            <ErrorBanner
              message={error}
              variant="banner"
              onRetry={runStartup}
              onDismiss={() => setError(null)}
            />
          )}
          <AnimatePresence mode="wait" initial={false} custom={sectionDir}>
            <motion.div
              key={sidebarSection + (selectedPersonaId || '')}
              custom={sectionDir}
              variants={sectionFadeVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={sectionTransition}
              className="flex-1 flex flex-col w-full min-w-0 overflow-y-hidden"
            >
              {renderContent()}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Desktop footer bar */}
      <DesktopFooter />
      </div>
    </CredentialNavProvider>
    </CanvasDragProvider>
  );
}
