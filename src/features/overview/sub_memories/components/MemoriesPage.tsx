import MemoriesPageDense from './MemoriesPageDense';

/**
 * Knowledge → Memories view.
 *
 * "Dense" (the KPI strip + sortable matrix layout) is the production baseline
 * as of 2026-06-17: the earlier Baseline virtualized-list layout and the
 * prototype variant switcher were retired, and the "Graph" cluster view was
 * promoted into the KnowledgeHub nav alongside Memories / Patterns. This stays
 * as the named view boundary so the `KnowledgeHub` import and the
 * `sub_memories` barrel re-export keep resolving.
 */
export default function MemoriesPage() {
  return <MemoriesPageDense />;
}
