import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useDesignReviews } from '@/hooks/design/template/useDesignReviews';
import { useVaultStore } from "@/stores/vaultStore";
import { useSystemStore } from "@/stores/systemStore";
import { GeneratedReviewsTab } from '@/features/templates/sub_generated';
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
  const { t } = useTranslation();
  const {
    reviews,
    error,
    refresh,
  } = useDesignReviews();

  const credentials = useVaultStore((s) => s.credentials);
  const connectorDefinitions = useVaultStore((s) => s.connectorDefinitions);
  const activeTab = useSystemStore((s) => s.templateTab);
  const [diagramReview, setDiagramReview] = useState<PersonaDesignReview | null>(null);
  const galleryTotal = useSystemStore((s) => s.templateGalleryTotal);
  const setGalleryTotal = useSystemStore((s) => s.setTemplateGalleryTotal);

  return (
    <ContentBox data-testid="templates-page">
      <ContentHeader
        icon={<FlaskConical className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={t.templates.page.title}
        subtitle={(() => {
          const count = activeTab === 'generated' && galleryTotal > 0 ? galleryTotal : reviews.length;
          return (count === 1 ? t.templates.page.subtitle_one : t.templates.page.subtitle_other).replace('{count}', String(count));
        })()}
      />

      {/* Error */}
      {error && (
        <div className="px-6 py-3 bg-red-500/10 border-b border-red-500/20 typo-body text-red-400">
          {error}
        </div>
      )}

      {/* Tab content */}
      <ContentBody noPadding>
        <div key={activeTab} className="animate-fade-slide-in flex-1 min-h-0 flex flex-col">
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
        </div>
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

    </ContentBox>
  );
}
