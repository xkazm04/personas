import { Suspense, useState } from 'react';
import { Brain, Network, GitFork } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { lazyRetry } from '@/lib/lazyRetry';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { ContentBox, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { ContentHeaderSkeleton } from '@/features/shared/components/layout/ContentHeaderSkeleton';
import { ListSkeleton } from '@/features/shared/components/layout/ListSkeleton';
import MemoriesPage from '@/features/overview/sub_memories/components/MemoriesPage';

// The Patterns view (execution-extracted knowledge graph) and the Graph cluster
// view are non-default branches with heavy component trees, so each loads only
// when its tab is selected.
const KnowledgeGraphDashboard = lazyRetry(() => import('@/features/overview/sub_knowledge'));
const MemoriesPageGraph = lazyRetry(() => import('@/features/overview/sub_memories/components/MemoriesPageGraph'));

type KnowledgeSubtab = 'memories' | 'patterns' | 'graph';

// Calm, content-shaped Suspense fallback for the lazy Patterns/Graph chunks —
// mirrors the ContentBox/ContentHeader/ContentBody frame those views render
// once loaded, so switching subtabs never blanks the body (golden loading
// pattern, docs/design/overview-loading.md). No pulse: this is a chunk-load
// gate, not a data-fetch gate, so it should read as calm structure, not a
// busy spinner.
const lazyFallback = (
  <ContentBox>
    <ContentHeaderSkeleton showIcon showSubtitle calm />
    <ContentBody flex>
      <ListSkeleton calm rows={6} rowHeight={64} />
    </ContentBody>
  </ContentBox>
);

export default function KnowledgeHub() {
  const { t } = useTranslation();
  const [subtab, setSubtab] = useState<KnowledgeSubtab>('memories');

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="px-4 md:px-6 py-2 border-b border-primary/10 bg-secondary/10 flex-shrink-0">
        <SegmentedTabs<KnowledgeSubtab>
          tabs={[
            { id: 'memories', label: <><Brain className="w-3.5 h-3.5" />{t.overview.memories.title}</>, ariaLabel: t.overview.memories.title },
            { id: 'patterns', label: <><Network className="w-3.5 h-3.5" />{t.overview.knowledge.patterns_tab}</>, ariaLabel: t.overview.knowledge.patterns_tab },
            { id: 'graph', label: <><GitFork className="w-3.5 h-3.5" />{t.overview.knowledge.graph_tab}</>, ariaLabel: t.overview.knowledge.graph_tab },
          ]}
          activeTab={subtab}
          onTabChange={setSubtab}
          ariaLabel={t.overview.knowledge.title}
          fullWidth={false}
        />
      </div>

      {subtab === 'memories' ? (
        <MemoriesPage />
      ) : subtab === 'graph' ? (
        <Suspense fallback={lazyFallback}>
          <MemoriesPageGraph />
        </Suspense>
      ) : (
        <Suspense fallback={lazyFallback}>
          <KnowledgeGraphDashboard />
        </Suspense>
      )}
    </div>
  );
}
