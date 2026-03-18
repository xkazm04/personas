import { useState } from 'react';
import { FlaskConical, Users } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useDesignReviews } from '@/hooks/design/template/useDesignReviews';
import { useVaultStore } from "@/stores/vaultStore";
import { useSystemStore } from "@/stores/systemStore";
import { GeneratedReviewsTab, TeamSynthesisPanel } from '@/features/templates/sub_generated';
import N8nImportTab from '@/features/templates/sub_n8n/steps/N8nImportTab';
import { ErrorBoundary } from '@/features/shared/components/feedback/ErrorBoundary';
import ActivityDiagramModal from '@/features/templates/sub_diagrams/ActivityDiagramModal';
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
    refresh,
  } = useDesignReviews();

  const credentials = useVaultStore((s) => s.credentials);
  const connectorDefinitions = useVaultStore((s) => s.connectorDefinitions);
  const activeTab = useSystemStore((s) => s.templateTab);
  const [showSynthesis, setShowSynthesis] = useState(false);
  const [diagramReview, setDiagramReview] = useState<PersonaDesignReview | null>(null);
  const galleryTotal = useSystemStore((s) => s.templateGalleryTotal);
  const setGalleryTotal = useSystemStore((s) => s.setTemplateGalleryTotal);

  return (
    <ContentBox data-testid="templates-page">
      <ContentHeader
        icon={<FlaskConical className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title="Agentic Templates"
        subtitle={(() => {
          const count = activeTab === 'generated' && galleryTotal > 0 ? galleryTotal : reviews.length;
          return `${count} template${count !== 1 ? 's' : ''} available`;
        })()}
        actions={
          <button
            onClick={() => setShowSynthesis(true)}
            className="px-4 py-2 text-sm rounded-xl bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors flex items-center gap-2"
          >
            <Users className="w-3.5 h-3.5" />
            Synthesize Team
          </button>
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
            credentials={credentials}
            connectorDefinitions={connectorDefinitions}
            onPersonaCreated={refresh}
            onViewFlows={setDiagramReview}
            onTotalChange={setGalleryTotal}
          />
        )}
      </ContentBody>

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
