import { useEffect, useState, lazy, Suspense } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import Sidebar from '@/features/shared/components/Sidebar';
import HomePage from '@/features/home/components/HomePage';
import PersonaEditor from '@/features/agents/sub_editor/PersonaEditor';
import { EventsPage } from '@/features/triggers/components/EventsPage';
import { CredentialManager } from '@/features/vault/sub_manager/CredentialManager';
import PersonaOverviewPage from '@/features/agents/components/PersonaOverviewPage';
import DesignReviewsPage from '@/features/templates/components/DesignReviewsPage';
import CloudDeployPanel from '@/features/deployment/components/CloudDeployPanel';
import SettingsPage from '@/features/settings/components/SettingsPage';
import CreationWizard from '@/features/agents/components/CreationWizard';
import { CredentialNavProvider } from '@/features/vault/hooks/CredentialNavContext';

const TeamCanvas = lazy(() => import('@/features/pipeline/components/TeamCanvas'));
const OverviewPage = lazy(() => import('@/features/overview/components/OverviewPage'));
const GitLabPanel = lazy(() => import('@/features/gitlab/components/GitLabPanel'));

export default function PersonasPage() {
  const prefersReducedMotion = useReducedMotion();
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
  const fetchPendingReviewCount = usePersonaStore((s) => s.fetchPendingReviewCount);
  const fetchGroups = usePersonaStore((s) => s.fetchGroups);

  const fetchDetail = usePersonaStore((s) => s.fetchDetail);

  const lazyFallback = (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground/80">
      Loading panel...
    </div>
  );

  // True only after fetchPersonas has settled (success or fail).
  // Prevents showing CreationWizard before the first load completes.
  const [personasFetched, setPersonasFetched] = useState(false);

  useEffect(() => {
    // Run all startup fetches in parallel and collect failures.
    // Using Promise.allSettled prevents any single call's error from overwriting
    // the others — the final store.error is the aggregate of all failures.
    const STARTUP_LABELS = ['personas', 'tools', 'credentials', 'pending review', 'groups'] as const;
    Promise.allSettled([
      fetchPersonas(),
      fetchToolDefinitions(),
      fetchCredentials(),
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
    });
  }, [fetchPersonas, fetchToolDefinitions, fetchCredentials, fetchPendingReviewCount, fetchGroups, setError]);

  // Hydrate persisted persona selection on app restart
  useEffect(() => {
    if (selectedPersonaId) {
      fetchDetail(selectedPersonaId);
    }
  }, []);

  const renderContent = () => {
    // Show unified wizard when no personas exist OR when explicitly creating
    if (sidebarSection === 'personas') {
      if (personasFetched && !isLoading && !error && personas.length === 0) {
        return <CreationWizard />;
      }
      if (isCreatingPersona) {
        return <CreationWizard canCancel />;
      }
    }

    if (sidebarSection === 'home') return <HomePage />;
    if (sidebarSection === 'team') {
      return (
        <Suspense fallback={lazyFallback}>
          <TeamCanvas />
        </Suspense>
      );
    }
    if (sidebarSection === 'cloud') {
      return (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={cloudTab}
            initial={{ opacity: 0, x: prefersReducedMotion ? 0 : cloudTab === 'gitlab' ? 14 : -14 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: prefersReducedMotion ? 0 : cloudTab === 'gitlab' ? -14 : 14 }}
            transition={{ duration: prefersReducedMotion ? 0.12 : 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="h-full"
          >
            {cloudTab === 'gitlab' ? (
              <Suspense fallback={lazyFallback}>
                <GitLabPanel />
              </Suspense>
            ) : (
              <CloudDeployPanel />
            )}
          </motion.div>
        </AnimatePresence>
      );
    }
    if (sidebarSection === 'overview') {
      return (
        <Suspense fallback={lazyFallback}>
          <OverviewPage />
        </Suspense>
      );
    }
    if (sidebarSection === 'credentials') return <CredentialManager />;
    if (sidebarSection === 'events') return <EventsPage />;
    if (sidebarSection === 'design-reviews') return <DesignReviewsPage />;
    if (sidebarSection === 'settings') return <SettingsPage />;
    if (selectedPersonaId) return <PersonaEditor />;
    return <PersonaOverviewPage />;
  };

  return (
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
        <motion.div
          key={sidebarSection + (selectedPersonaId || '')}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="flex-1 flex flex-col overflow-x-auto overflow-y-hidden"
        >
          {renderContent()}
        </motion.div>
      </div>
      </div>
    </CredentialNavProvider>
  );
}
