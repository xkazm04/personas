import { Suspense, useState } from 'react';
import { Brain, Network, GitFork } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { lazyRetry } from '@/lib/lazyRetry';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { ContentBox } from '@/features/shared/components/layout/ContentLayout';
import { ContentHeaderSkeleton } from '@/features/shared/components/layout/ContentHeaderSkeleton';
import MemoriesPage from '@/features/overview/sub_memories/components/MemoriesPage';

// The Patterns view (execution-extracted knowledge graph) and the Graph cluster
// view are non-default branches with heavy component trees, so each loads only
// when its tab is selected.
const KnowledgeGraphDashboard = lazyRetry(() => import('@/features/overview/sub_knowledge'));
const MemoriesPageGraph = lazyRetry(() => import('@/features/overview/sub_memories/components/MemoriesPageGraph'));

type KnowledgeSubtab = 'memories' | 'patterns' | 'graph';

// Suspense fallback for the lazy Patterns/Graph chunks (docs/design/overview-loading.md
// §D). The whole fallback sits behind a 150ms `animation-delay` with
// `fill-mode: both`, so a warm chunk resolves before a single pixel of it
// paints — no flash on subtab switches. Only the header band ghosts in: it's
// the one region every subtab shares at the same position (ContentHeader).
// Body geometry differs across Memories/Patterns/Graph (dense table vs SVG
// canvas vs virtualized list) — faking any one of them would produce exactly
// the skeleton-mismatch blink this pattern forbids, so the body stays empty.
function KnowledgeLazyFallback() {
  return (
    <div
      aria-hidden="true"
      className="flex-1 min-h-0 flex flex-col animate-fade-in"
      style={{ animationDelay: '150ms' }}
    >
      <ContentBox>
        <ContentHeaderSkeleton showIcon showSubtitle calm />
      </ContentBox>
    </div>
  );
}

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
        <Suspense fallback={<KnowledgeLazyFallback />}>
          <MemoriesPageGraph />
        </Suspense>
      ) : (
        <Suspense fallback={<KnowledgeLazyFallback />}>
          <KnowledgeGraphDashboard />
        </Suspense>
      )}
    </div>
  );
}
