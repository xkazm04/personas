import { useEffect, useState, useCallback, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMotion } from '@/hooks/utility/useMotion';
import { usePersonaStore } from '@/stores/personaStore';
import Sidebar from '@/features/shared/components/Sidebar';
import { IS_MOBILE } from '@/lib/utils/platform';
import HomePage from '@/features/home/components/HomePage';
import { PersonaEditor } from '@/features/agents/sub_editor';
import PersonaOverviewPage from '@/features/agents/components/PersonaOverviewPage';
import CreationWizard from '@/features/agents/components/CreationWizard';
import { CredentialNavProvider } from '@/features/vault/hooks/CredentialNavContext';
import { ErrorBanner } from '@/features/shared/components/ErrorBanner';
import { ErrorBoundary } from '@/features/shared/components/ErrorBoundary';
import { CanvasDragProvider } from '@/features/pipeline/sub_canvas';
import ContentLoader from '@/features/shared/components/ContentLoader';

const OverviewPage = lazy(() => import('@/features/overview/components/OverviewPage'));
const CredentialManager = lazy(() => import('@/features/vault/sub_manager/CredentialManager').then(m => ({ default: m.CredentialManager })));
const TeamCanvas = lazy(() => import('@/features/pipeline/components/TeamCanvas'));
const DesignReviewsPage = lazy(() => import('@/features/templates/components/DesignReviewsPage'));
const SettingsPage = lazy(() => import('@/features/settings/components/SettingsPage'));
const EventsPage = lazy(() => import('@/features/triggers/components/EventsPage').then(m => ({ default: m.EventsPage })));
const CloudDeployPanel = lazy(() => import('@/features/deployment/components/CloudDeployPanel'));
const GitLabPanel = lazy(() => import('@/features/gitlab/components/GitLabPanel'));
const UnifiedDeploymentDashboard = lazy(() => import('@/features/deployment/components/UnifiedDeploymentDashboard'));

export default function PersonasPage() {
  const { shouldAnimate, transition } = useMotion();
  const sidebarSection = usePersonaStore((s) => s.sidebarSection);
  const cloudTab = usePersonaStore((s) => s.cloudTab);
  const selectedPersonaId = usePersonaStore((s) => s.selectedPersonaId);
  const isCreatingPersona = usePersonaStore((s) => s.isCreatingPersona);
  const personas = usePersonaStore((s) => s.personas);
  const isLoading = usePersonaStore((s) => s.isLoading);
  const error = usePersonaStore((s) => s.error);
  const setError = usePersonaStore((s) => s.setError);
  const fetchPersonas = usePersonaStore((s) => s.fetchPersonas);
  const fetchToolDefinitions = usePersonaStore((s) => s.fetchToolDefinitions);
  const fetchCredentials = usePersonaStore((s) => s.fetchCredentials);
  const fetchRecipes = usePersonaStore((s) => s.fetchRecipes);
  const fetchPendingReviewCount = usePersonaStore((s) => s.fetchPendingReviewCount);
  const fetchGroups = usePersonaStore((s) => s.fetchGroups);

  const fetchDetail = usePersonaStore((s) => s.fetchDetail);


  // True only after fetchPersonas has settled (success or fail).
  // Prevents showing CreationWizard before the first load completes.
  const [personasFetched, setPersonasFetched] = useState(false);

  const runStartup = useCallback(() => {
    // Run all startup fetches in parallel and collect failures.
    // Using Promise.allSettled prevents any single call's error from overwriting
    // the others — the final store.error is the aggregate of all failures.
    setError(null);
    const STARTUP_LABELS = ['personas', 'tools', 'credentials', 'recipes', 'pending review', 'groups'] as const;
    Promise.allSettled([
      fetchPersonas(),
      fetchToolDefinitions(),
      fetchCredentials(),
      fetchRecipes(),
      fetchPendingReviewCount(),
      fetchGroups(),
    ]).then((results) => {
      setPersonasFetched(true);
      const failed = (results as PromiseSettledResult<void>[])
        .map((r, i) => (r.status === 'rejected' ? STARTUP_LABELS[i] : null))
        .filter((l): l is NonNullable<typeof l> => l !== null);
      if (failed.length > 0) {
        setError(`Startup failed — ${failed.join(', ')} could not be loaded`);
      }
    }).catch(() => {
      setPersonasFetched(true);
    });
  }, [fetchPersonas, fetchToolDefinitions, fetchCredentials, fetchRecipes, fetchPendingReviewCount, fetchGroups, setError]);

  useEffect(() => {
    runStartup();
  }, [runStartup]);

  // Hydrate persisted persona selection on app restart
  useEffect(() => {
    if (selectedPersonaId) {
      fetchDetail(selectedPersonaId).catch(() => {/* non-critical: persisted selection may be stale */});
    }
  }, []);

  const renderContent = () => {
    // Show unified wizard when no personas exist OR when explicitly creating
    if (sidebarSection === 'personas') {
      if (personasFetched && !isLoading && !error && personas.length === 0) {
        return <ErrorBoundary name="CreationWizard"><CreationWizard /></ErrorBoundary>;
      }
      if (isCreatingPersona) {
        return <ErrorBoundary name="CreationWizard"><CreationWizard canCancel /></ErrorBoundary>;
      }
    }

    if (sidebarSection === 'home') return <ErrorBoundary name="Home"><HomePage /></ErrorBoundary>;
    if (sidebarSection === 'team') {
      return <ErrorBoundary name="Teams"><Suspense fallback={<ContentLoader hint={sidebarSection} />}><TeamCanvas /></Suspense></ErrorBoundary>;
    }
    if (sidebarSection === 'cloud') {
      return (
        <ErrorBoundary name="Cloud">
        <Suspense fallback={<ContentLoader hint={sidebarSection} />}>
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
      return <ErrorBoundary name="Overview"><Suspense fallback={<ContentLoader hint={sidebarSection} />}><OverviewPage /></Suspense></ErrorBoundary>;
    }
    if (sidebarSection === 'credentials') return <ErrorBoundary name="Vault"><Suspense fallback={<ContentLoader hint={sidebarSection} />}><CredentialManager /></Suspense></ErrorBoundary>;
    if (sidebarSection === 'events') return <ErrorBoundary name="Triggers"><Suspense fallback={<ContentLoader hint={sidebarSection} />}><EventsPage /></Suspense></ErrorBoundary>;
    if (sidebarSection === 'design-reviews') return <ErrorBoundary name="Design Reviews"><Suspense fallback={<ContentLoader hint={sidebarSection} />}><DesignReviewsPage /></Suspense></ErrorBoundary>;
    if (sidebarSection === 'settings') return <ErrorBoundary name="Settings"><Suspense fallback={<ContentLoader hint={sidebarSection} />}><SettingsPage /></Suspense></ErrorBoundary>;
    if (selectedPersonaId) return <ErrorBoundary name="Agent Editor"><PersonaEditor /></ErrorBoundary>;
    return <ErrorBoundary name="Agent Overview"><PersonaOverviewPage /></ErrorBoundary>;
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
        <div className={`flex-1 flex flex-col ${IS_MOBILE ? 'overflow-x-hidden' : 'overflow-x-auto'} overflow-y-hidden`}>
          {error && (
            <ErrorBanner
              message={error}
              variant="banner"
              onRetry={runStartup}
              onDismiss={() => setError(null)}
            />
          )}
          <motion.div
            key={sidebarSection + (selectedPersonaId || '')}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="flex-1 flex flex-col w-full min-w-0 overflow-y-hidden"
          >
            {renderContent()}
          </motion.div>
        </div>
      </div>
      </div>
    </CredentialNavProvider>
    </CanvasDragProvider>
  );
}
