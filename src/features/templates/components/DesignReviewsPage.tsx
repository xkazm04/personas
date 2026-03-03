import { useState, useMemo } from 'react';
import { FlaskConical, Play, Users } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import { useDesignReviews } from '@/hooks/design/useDesignReviews';
import { usePersonaStore } from '@/stores/personaStore';
import { DesignReviewRunner, GeneratedReviewsTab, TeamSynthesisPanel } from '@/features/templates/sub_generated';
import type { PredefinedTestCase } from '@/features/templates/sub_generated';
import N8nImportTab from '@/features/templates/sub_n8n/N8nImportTab';
import { ErrorBoundary } from '@/features/shared/components/ErrorBoundary';
import ActivityDiagramModal from '@/features/triggers/components/ActivityDiagramModal';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import { parseJsonOrDefault as parseJsonSafe } from '@/lib/utils/parseJson';

// ============================================================================
// Main Component
// ============================================================================

export default function DesignReviewsPage() {
  const {
    reviews,
    error,
    runLines,
    isRunning,
    runResult,
    runProgress,
    refresh,
    startNewReview,
    cancelReview,
  } = useDesignReviews();

  const selectedPersonaId = usePersonaStore((s) => s.selectedPersonaId);
  const personas = usePersonaStore((s) => s.personas);
  const credentials = usePersonaStore((s) => s.credentials);
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const activeTab = usePersonaStore((s) => s.templateTab);
  const [showRunner, setShowRunner] = useState(false);
  const [showSynthesis, setShowSynthesis] = useState(false);
  const [diagramReview, setDiagramReview] = useState<PersonaDesignReview | null>(null);
  const [galleryTotal, setGalleryTotal] = useState<number | null>(null);

  const selectedPersona = useMemo(
    () => personas.find((p) => p.id === selectedPersonaId) ?? null,
    [personas, selectedPersonaId],
  );

  const handleStartReview = () => {
    setShowRunner(true);
  };

  const handleRunnerStart = (options?: { testCases?: PredefinedTestCase[] }) => {
    if (!selectedPersonaId) return;
    startNewReview(selectedPersonaId, options?.testCases);
  };

  const handleRunnerClose = () => {
    setShowRunner(false);
  };

  return (
    <ContentBox>
      <ContentHeader
        icon={<FlaskConical className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title="Agentic Templates"
        subtitle={(() => {
          const count = activeTab === 'generated' && galleryTotal !== null ? galleryTotal : reviews.length;
          return `${count} template${count !== 1 ? 's' : ''} available`;
        })()}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSynthesis(true)}
              className="px-4 py-2 text-sm rounded-xl bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors flex items-center gap-2"
            >
              <Users className="w-3.5 h-3.5" />
              Synthesize Team
            </button>
            <button
              onClick={handleStartReview}
              disabled={isRunning}
              className="px-4 py-2 text-sm rounded-xl bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors flex items-center gap-2"
            >
              <Play className="w-3.5 h-3.5" />
              Generate Templates
            </button>
          </div>
        }
      />

      {/* Error */}
      {error && (
        <div className="px-6 py-3 bg-red-500/10 border-b border-red-500/20 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Tab content */}
      <ContentBody noPadding>
        {activeTab === 'n8n' && (
          <ErrorBoundary name="n8n Import">
            <N8nImportTab />
          </ErrorBoundary>
        )}
        {activeTab === 'generated' && (
          <GeneratedReviewsTab
            isRunning={isRunning}
            handleStartReview={handleStartReview}
            credentials={credentials}
            connectorDefinitions={connectorDefinitions}
            onPersonaCreated={refresh}
            onViewFlows={setDiagramReview}
            onTotalChange={setGalleryTotal}
          />
        )}
      </ContentBody>

      {/* Runner modal */}
      <DesignReviewRunner
        isOpen={showRunner}
        onClose={handleRunnerClose}
        lines={runLines}
        isRunning={isRunning}
        result={runResult}
        runProgress={runProgress}
        personaName={selectedPersona?.name}
        personaDescription={selectedPersona?.description ?? undefined}
        onStart={handleRunnerStart}
        onCancel={cancelReview}
      />

      {/* Activity diagram modal */}
      {diagramReview && (
        <ActivityDiagramModal
          isOpen={!!diagramReview}
          onClose={() => setDiagramReview(null)}
          templateName={diagramReview.test_case_name}
          flows={parseJsonSafe<UseCaseFlow[]>(diagramReview.use_case_flows, [])}
        />
      )}

      {/* Team Synthesis panel */}
      <TeamSynthesisPanel
        isOpen={showSynthesis}
        onClose={() => setShowSynthesis(false)}
        onTeamCreated={() => {
          refresh();
        }}
      />
    </ContentBox>
  );
}
