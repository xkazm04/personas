import { useState, useCallback, useRef, useEffect } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import type { TeamMemory } from '@/lib/bindings/TeamMemory';
import type { TeamMemoryStats } from '@/lib/bindings/TeamMemoryStats';
import type { CreateTeamMemoryInput } from '@/lib/bindings/CreateTeamMemoryInput';
import MemoryPanelHeader from './MemoryPanelHeader';
import MemoryPanelList from './MemoryPanelList';
import AddTeamMemoryForm from './AddTeamMemoryForm';
import MemoryTimeline from '../timeline/MemoryTimeline';
import RunDiffView from '../diff/RunDiffView';
import type { TeamMemoryViewMode as ViewMode } from '@/lib/constants/uiModes';
import { useRafCoalescedCallback } from '@/hooks/utility/timing/useRafCoalescedCallback';

const STORAGE_KEY = 'team-memory-panel-width';
const MIN_WIDTH = 272;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 288; // matches original w-72
/** `left-3` (12px) plus the same breathing room on the right edge. */
const FLOATING_GUTTER_PX = 24;

/**
 * Panel width is a per-viewer convenience, so every access is guarded: reading
 * or writing localStorage THROWS (not returns null) under a blocked-site-data
 * policy or a sandboxed context, and an unguarded read here happened inside a
 * useState initializer -- i.e. it would have taken the whole panel down.
 */
function readStoredWidth(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const n = Number(stored);
      if (n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
    }
  } catch (err) {
    // Storage unavailable -- the default width is a complete answer.
    silentCatch('teamMemory/TeamMemoryPanel:readStoredWidth')(err);
  }
  return DEFAULT_WIDTH;
}

function writeStoredWidth(width: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(width));
  } catch (err) {
    // Non-persisted width is a degraded convenience, never a user-facing error.
    silentCatch('teamMemory/TeamMemoryPanel:writeStoredWidth')(err);
  }
}

interface TeamMemoryPanelProps {
  teamId: string;
  memories: TeamMemory[];
  total: number;
  stats: TeamMemoryStats | null;
  /** `floating` (default) overlays a canvas with a resize handle; `pane` fills its host. */
  layout?: 'floating' | 'pane';
  onClose: () => void;
  onDelete: (id: string) => void;
  onImportanceChange: (id: string, importance: number) => void;
  onCreate: (input: CreateTeamMemoryInput) => void;
  onFilter: (category?: string, search?: string) => void;
  onLoadMore: () => Promise<void>;
  onFilterByRun?: (runId: string | null) => void;
  onEdit?: (id: string, title: string, content: string, category: string, importance: number) => void;
}

export default function TeamMemoryPanel({
  teamId, memories, total, stats, layout = 'floating', onClose, onDelete, onImportanceChange,
  onCreate, onFilter, onLoadMore, onFilterByRun, onEdit,
}: TeamMemoryPanelProps) {
  const { t, tx } = useTranslation();
  const pt = t.pipeline;
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [statsExpanded, setStatsExpanded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [activeRunFilter, setActiveRunFilter] = useState<string | null>(null);

  const [panelWidth, setPanelWidth] = useState(readStoredWidth);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef(panelWidth);

  useEffect(() => {
    widthRef.current = panelWidth;
  }, [panelWidth]);

  const resizePanelFrame = useRafCoalescedCallback((clientX: number) => {
    if (!draggingRef.current || !panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, clientX - rect.left));
    setPanelWidth(newWidth);
  });

  // Window-level mousemove is the most expensive listener the app can hold, and
  // this one used to be registered for the panel's whole lifetime -- including
  // the `pane` layout, which renders no resize handle and can therefore never
  // drag. It now exists only for the duration of an actual drag.
  useEffect(() => {
    if (!dragging) return;
    const onMouseMove = (e: MouseEvent) => {
      resizePanelFrame(e.clientX);
    };
    const onMouseUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      writeStoredWidth(widthRef.current);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      // The drag can be torn down by unmount mid-gesture; the body styles the
      // gesture set are this effect's to reap either way.
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [dragging, resizePanelFrame]);

  const handleLoadMore = useCallback(async () => {
    setLoadingMore(true);
    try { await onLoadMore(); } finally { setLoadingMore(false); }
  }, [onLoadMore]);

  const handleCategoryChange = (cat: string) => {
    setActiveCategory(cat);
    onFilter(cat === 'all' ? undefined : cat, searchQuery || undefined);
  };

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleSearchChange = (q: string) => {
    setSearchQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onFilter(activeCategory === 'all' ? undefined : activeCategory, q || undefined);
    }, 300);
  };

  const handleFilterByRun = useCallback((runId: string | null) => {
    setActiveRunFilter(runId);
    if (runId) setViewMode('list');
    onFilterByRun?.(runId);
  }, [onFilterByRun]);

  const handleClearAllFilters = useCallback(() => {
    setActiveCategory('all');
    setSearchQuery('');
    setActiveRunFilter(null);
    onFilterByRun?.(null);
    onFilter(undefined, undefined);
  }, [onFilter, onFilterByRun]);

  const hasRunData = stats?.run_counts && stats.run_counts.length > 0;
  const isPane = layout === 'pane';

  // The stored width knows nothing about the viewport it is restored into. The
  // floating layout sits at `left-3` and can carry a width of up to MAX_WIDTH,
  // so on a narrow window the panel ran past the right edge and took the resize
  // handle (`right-0` of the panel) off screen with it -- leaving the user no
  // affordance to shrink it back. The cap is expressed in CSS rather than JS so
  // it re-applies on every window resize without a listener, and the drag maths
  // keeps working because it measures the panel's real (clamped) rect.
  const floatingStyle = { width: panelWidth, maxWidth: `calc(100vw - ${FLOATING_GUTTER_PX}px)` };

  return (
    <div
      ref={panelRef}
      style={isPane ? undefined : floatingStyle}
      className={
        isPane
          ? 'h-full w-full max-w-xl flex flex-col rounded-modal border border-primary/15 bg-secondary/30 overflow-hidden'
          : 'animate-fade-slide-in absolute top-14 left-3 z-30 bg-secondary/95 backdrop-blur-xl border border-primary/15 rounded-modal shadow-elevation-4 overflow-hidden'
      }
    >
      {/* Resize handle (floating layout only) */}
      {!isPane && (
        <div
          className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-primary/20 active:bg-primary/30 transition-colors z-10"
          onMouseDown={(e) => {
            e.preventDefault();
            draggingRef.current = true;
            setDragging(true);
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
          }}
        />
      )}
      <MemoryPanelHeader
        total={total}
        viewMode={viewMode}
        hasRunData={!!hasRunData}
        hasDiffData={!!stats?.run_counts && stats.run_counts.length >= 2}
        onViewModeChange={setViewMode}
        onClearRunFilter={() => handleFilterByRun(null)}
        onClose={onClose}
      />

      {viewMode === 'diff' ? (
        <div className={`${isPane ? 'flex-1 min-h-0' : 'max-h-80'} overflow-y-auto px-2 pb-2 space-y-1 scrollbar-thin scrollbar-thumb-primary/10`}>
          <RunDiffView stats={stats} onClose={() => setViewMode('list')} />
        </div>
      ) : viewMode === 'timeline' ? (
        <div className={`${isPane ? 'flex-1 min-h-0' : 'max-h-80'} overflow-y-auto px-2 pb-2 space-y-1 scrollbar-thin scrollbar-thumb-primary/10`}>
          <MemoryTimeline memories={memories} stats={stats} onFilterRun={handleFilterByRun} activeRunFilter={activeRunFilter} />
        </div>
      ) : (
        <MemoryPanelList
          memories={memories}
          total={total}
          activeCategory={activeCategory}
          searchQuery={searchQuery}
          activeRunFilter={activeRunFilter}
          loadingMore={loadingMore}
          fill={isPane}
          onCategoryChange={handleCategoryChange}
          onSearchChange={handleSearchChange}
          onClearRunFilter={() => handleFilterByRun(null)}
          onClearAll={handleClearAllFilters}
          onLoadMore={handleLoadMore}
          onDelete={onDelete}
          onImportanceChange={onImportanceChange}
          onEdit={onEdit}
        />
      )}

      <div className="px-2.5 pb-2.5">
        <AddTeamMemoryForm teamId={teamId} onSubmit={onCreate} />
      </div>

      {stats && stats.total > 0 && (
        <div className="border-t border-primary/10 px-3 py-2">
          <button
            type="button"
            className="flex items-center justify-between w-full typo-body text-foreground hover:text-muted-foreground/70"
            onClick={() => setStatsExpanded(!statsExpanded)}
          >
            <span>{tx(pt.avg_importance, { value: stats.avg_importance.toFixed(1), count: stats.category_counts.length })}</span>
            {statsExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {statsExpanded && (
            <div className="mt-1.5 space-y-0.5">
              {stats.category_counts.map(([cat, count]) => (
                <div key={cat} className="flex items-center justify-between typo-body">
                  <span className="text-foreground capitalize">{cat}</span>
                  <span className="text-foreground">{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
