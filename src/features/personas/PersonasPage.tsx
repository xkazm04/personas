import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import Sidebar from '@/features/shared/components/Sidebar';
import OverviewPage from '@/features/overview/components/OverviewPage';
import PersonaEditor from '@/features/agents/sub_editor/PersonaEditor';
import { EventsPage } from '@/features/triggers/components/EventsPage';
import { CredentialManager } from '@/features/vault/components/CredentialManager';
import PersonaOverviewPage from '@/features/agents/components/PersonaOverviewPage';
import DesignReviewsPage from '@/features/templates/components/DesignReviewsPage';
import TeamCanvas from '@/features/pipeline/components/TeamCanvas';
import CloudDeployPanel from '@/features/deployment/components/CloudDeployPanel';
import SettingsPage from '@/features/settings/components/SettingsPage';
import OnboardingWizard from '@/features/agents/components/OnboardingWizard';

export default function PersonasPage() {
  const sidebarSection = usePersonaStore((s) => s.sidebarSection);
  const selectedPersonaId = usePersonaStore((s) => s.selectedPersonaId);
  const personas = usePersonaStore((s) => s.personas);
  const isLoading = usePersonaStore((s) => s.isLoading);
  const fetchPersonas = usePersonaStore((s) => s.fetchPersonas);
  const fetchToolDefinitions = usePersonaStore((s) => s.fetchToolDefinitions);
  const fetchCredentials = usePersonaStore((s) => s.fetchCredentials);
  const fetchPendingReviewCount = usePersonaStore((s) => s.fetchPendingReviewCount);
  const fetchGroups = usePersonaStore((s) => s.fetchGroups);

  const fetchDetail = usePersonaStore((s) => s.fetchDetail);

  const [hasCheckedOnboarding, setHasCheckedOnboarding] = useState(false);

  useEffect(() => {
    fetchPersonas();
    fetchToolDefinitions();
    fetchCredentials();
    fetchPendingReviewCount();
    fetchGroups();
  }, [fetchPersonas, fetchToolDefinitions, fetchCredentials, fetchPendingReviewCount, fetchGroups]);

  // Hydrate persisted persona selection on app restart
  useEffect(() => {
    if (selectedPersonaId) {
      fetchDetail(selectedPersonaId);
    }
  }, []);

  // Wait for initial fetch to complete before checking onboarding
  useEffect(() => {
    const timer = setTimeout(() => setHasCheckedOnboarding(true), 500);
    return () => clearTimeout(timer);
  }, []);

  const renderContent = () => {
    // Show onboarding wizard when no personas exist and we're on the personas section
    if (hasCheckedOnboarding && !isLoading && personas.length === 0 && sidebarSection === 'personas') {
      return <OnboardingWizard />;
    }

    if (sidebarSection === 'team') return <TeamCanvas />;
    if (sidebarSection === 'cloud') return <CloudDeployPanel />;
    if (sidebarSection === 'overview') return <OverviewPage />;
    if (sidebarSection === 'credentials') return <CredentialManager />;
    if (sidebarSection === 'events') return <EventsPage />;
    if (sidebarSection === 'design-reviews') return <DesignReviewsPage />;
    if (sidebarSection === 'settings') return <SettingsPage />;
    if (selectedPersonaId) return <PersonaEditor />;
    return <PersonaOverviewPage />;
  };

  return (
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
          className="flex-1 flex flex-col overflow-hidden"
        >
          {renderContent()}
        </motion.div>
      </div>
    </div>
  );
}
