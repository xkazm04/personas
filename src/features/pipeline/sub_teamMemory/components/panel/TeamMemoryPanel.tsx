import { useState, useCallback, useRef, useEffect } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { TeamMemory } from '@/lib/bindings/TeamMemory';
import type { TeamMemoryStats } from '@/lib/bindings/TeamMemoryStats';
import type { CreateTeamMemoryInput } from '@/lib/bindings/CreateTeamMemoryInput';
import MemoryPanelHeader from './MemoryPanelHeader';
import MemoryPanelList from './MemoryPanelList';
import AddTeamMemoryForm from './AddTeamMemoryForm';
import MemoryTimeline from '../timeline/MemoryTimeline';
import RunDiffView from '../diff/RunDiffView';
import type { TeamMemoryViewMode as ViewMode } from '@/lib/constants/uiModes';

const STORAGE_KEY = 'team-memory-panel-width';
const MIN_WIDTH = 272;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 288; // matches original w-72

interface TeamMemoryPanelProps {
  teamId: string;
  memories: TeamMemory[];
  total: number;
  stats: TeamMemoryStats | null;
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
  teamId, memories, total, stats, onClose, onDelete, onImportanceChange,
  onCreate, onFilter, onLoadMore, onFilterByRun, onEdit,
}: TeamMemoryPanelProps) {
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [statsExpanded, setStatsExpanded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [activeRunFilter, setActiveRunFilter] = useState<string | null>(null);

  const [panelWidth, setPanelWidth] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const n = Number(stored);
      if (n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
    }
    return DEFAULT_WIDTH;
  });
  const draggingRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef(panelWidth);

  useEffect(() => {
    widthRef.current = panelWidth;
  }, [panelWidth]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current || !panelRef.current) return;
      const rect = panelRef.current.getBoundingClientRect();
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX - rect.left));
      setPanelWidth(newWidth);
    };
    const onMouseUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem(STORAGE_KEY, String(widthRef.current));
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

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

  const hasRunData = stats?.run_counts && stats.run_counts.length > 0;

  return (
    <div
      ref={panelRef}
      style={{ width: panelWidth }}
      className="animate-fade-slide-in absolute top-14 left-3 z-30 bg-secondary/95 backdrop-blur-xl border border-primary/15 rounded-modal shadow-elevation-4 overflow-hidden"
    >
      {/* Resize handle */}
      <div
        className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-primary/20 active:bg-primary/30 transition-colors z-10"
        onMouseDown={(e) => {
          e.preventDefault();
          draggingRef.current = true;
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
        }}
      />
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
        <div className="max-h-80 overflow-y-auto px-2 pb-2 space-y-1 scrollbar-thin scrollbar-thumb-primary/10">
          <RunDiffView stats={stats} onClose={() => setViewMode('list')} />
        </div>
      ) : viewMode === 'timeline' ? (
        <div className="max-h-80 overflow-y-auto px-2 pb-2 space-y-1 scrollbar-thin scrollbar-thumb-primary/10">
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
          onCategoryChange={handleCategoryChange}
          onSearchChange={handleSearchChange}
          onClearRunFilter={() => handleFilterByRun(null)}
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
            className="flex items-center justify-between w-full typo-body text-foreground hover:text-muted-foreground/70"
            onClick={() => setStatsExpanded(!statsExpanded)}
          >
            <span>Avg importance: {stats.avg_importance.toFixed(1)} | {stats.category_counts.length} categories</span>
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
