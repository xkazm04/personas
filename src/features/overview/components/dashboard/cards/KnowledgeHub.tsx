import { Suspense, useEffect, useState } from 'react';
import { Brain, Library, Network, GitFork } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { lazyRetry } from '@/lib/lazyRetry';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { ContentBox } from '@/features/shared/components/layout/ContentLayout';
import { ContentHeaderSkeleton } from '@/features/shared/components/layout/ContentHeaderSkeleton';
import MemoriesPage from '@/features/overview/sub_memories/components/MemoriesPage';
import { useSystemStore } from '@/stores/systemStore';

// Patterns (the curated workspace practice library), Extracted (the
// execution-derived knowledge graph — this tab used to be called "Patterns",
// renamed when the library took the name) and the Graph cluster view are all
// non-default branches with heavy component trees, so each loads only when its
// tab is selected.
const PatternsPanel = lazyRetry(() => import('@/features/overview/sub_patterns/PatternsPanel'));
const KnowledgeGraphDashboard = lazyRetry(() => import('@/features/overview/sub_knowledge'));
const MemoriesPageGraph = lazyRetry(() => import('@/features/overview/sub_memories/components/MemoriesPageGraph'));

type KnowledgeSubtab = 'memories' | 'patterns' | 'extracted' | 'graph';

// Suspense fallback for the lazy Patterns/Extracted/Graph chunks (docs/design/overview-loading.md
// §D). The whole fallback sits behind a 150ms `animation-delay` with
// `fill-mode: both`, so a warm chunk resolves before a single pixel of it
// paints — no flash on subtab switches. Only the header band ghosts in: it's
// the one region every subtab shares at the same position (ContentHeader).
// Body geometry differs across every subtab (dense table vs SVG
// canvas vs virtualized list vs practice tree) — faking any one of them would
// produce exactly the skeleton-mismatch blink this pattern forbids, so the body
// stays empty.
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

  // Deep-link handoff (mirror of `pendingApprovalsMode`): another surface can
  // ask Knowledge to open on a specific subtab. Consumed once on mount and
  // cleared, so a later manual tab change isn't reverted on the next remount.
  useEffect(() => {
    const pending = useSystemStore.getState().pendingKnowledgeSubtab;
    if (!pending) return;
    setSubtab(pending);
    useSystemStore.getState().setPendingKnowledgeSubtab(null);
  }, []);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="px-4 md:px-6 py-2 border-b border-primary/10 bg-secondary/10 flex-shrink-0">
        <SegmentedTabs<KnowledgeSubtab>
          tabs={[
            { id: 'memories', label: <><Brain className="w-3.5 h-3.5" />{t.overview.memories.title}</>, ariaLabel: t.overview.memories.title },
            { id: 'patterns', label: <><Library className="w-3.5 h-3.5" />{t.overview.knowledge.patterns_library_tab}</>, ariaLabel: t.overview.knowledge.patterns_library_tab },
            { id: 'extracted', label: <><Network className="w-3.5 h-3.5" />{t.overview.knowledge.extracted_tab}</>, ariaLabel: t.overview.knowledge.extracted_tab },
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
      ) : subtab === 'patterns' ? (
        <Suspense fallback={<KnowledgeLazyFallback />}>
          <PatternsPanel />
        </Suspense>
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
