import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Brain, ChevronDown, ChevronUp, Search } from 'lucide-react';
import type { TeamMemory } from '@/lib/bindings/TeamMemory';
import type { TeamMemoryStats } from '@/lib/bindings/TeamMemoryStats';
import type { CreateTeamMemoryInput } from '@/lib/bindings/CreateTeamMemoryInput';
import TeamMemoryRow from './TeamMemoryRow';
import AddTeamMemoryForm from './AddTeamMemoryForm';

const CATEGORY_FILTERS = ['all', 'observation', 'decision', 'context', 'learning'] as const;

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
}

export default function TeamMemoryPanel({
  teamId,
  memories,
  total,
  stats,
  onClose,
  onDelete,
  onImportanceChange,
  onCreate,
  onFilter,
}: TeamMemoryPanelProps) {
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [statsExpanded, setStatsExpanded] = useState(false);

  const handleCategoryChange = (cat: string) => {
    setActiveCategory(cat);
    onFilter(cat === 'all' ? undefined : cat, searchQuery || undefined);
  };

  const handleSearchChange = (q: string) => {
    setSearchQuery(q);
    onFilter(activeCategory === 'all' ? undefined : activeCategory, q || undefined);
  };

  const filteredMemories = useMemo(() => {
    // Backend handles filtering, but we can also filter locally for instant UI
    return memories;
  }, [memories]);

  return (
    <motion.div
      initial={{ x: -280, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -280, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="absolute top-14 left-3 z-30 w-72 bg-secondary/95 backdrop-blur-xl border border-primary/15 rounded-xl shadow-2xl overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-primary/10">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-semibold text-foreground/90">Team Memory</span>
          <span className="text-sm px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-400 font-medium">
            {total}
          </span>
        </div>
        <button
          className="p-1 rounded-lg hover:bg-primary/10 text-muted-foreground/60"
          onClick={onClose}
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>

      {/* Category chips */}
      <div className="flex gap-1 px-3 py-2 overflow-x-auto scrollbar-hide">
        {CATEGORY_FILTERS.map((cat) => (
          <button
            key={cat}
            className={`text-sm px-2 py-0.5 rounded-full capitalize whitespace-nowrap transition-colors ${
              activeCategory === cat
                ? 'bg-violet-500/20 text-violet-400 font-medium'
                : 'bg-primary/5 text-muted-foreground/60 hover:bg-primary/10'
            }`}
            onClick={() => handleCategoryChange(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/40" />
          <input
            className="w-full text-sm bg-primary/5 border border-primary/10 rounded-xl pl-6 pr-2 py-1.5 text-foreground/80 placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/20"
            placeholder="Search memories..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>
      </div>

      {/* Memory list */}
      <div className="max-h-80 overflow-y-auto px-2 pb-2 space-y-1 scrollbar-thin scrollbar-thumb-primary/10">
        {filteredMemories.length === 0 ? (
          <div className="text-center py-6">
            <Brain className="w-8 h-8 mx-auto mb-2 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground/50">No memories yet</p>
            <p className="text-sm text-muted-foreground/30 mt-0.5">
              Run a pipeline or add one manually
            </p>
          </div>
        ) : (
          filteredMemories.map((memory) => (
            <TeamMemoryRow
              key={memory.id}
              memory={memory}
              onDelete={onDelete}
              onImportanceChange={onImportanceChange}
            />
          ))
        )}
      </div>

      {/* Add Memory Form */}
      <div className="px-2.5 pb-2.5">
        <AddTeamMemoryForm teamId={teamId} onSubmit={onCreate} />
      </div>

      {/* Stats footer */}
      {stats && stats.total > 0 && (
        <div className="border-t border-primary/10 px-3 py-2">
          <button
            className="flex items-center justify-between w-full text-sm text-muted-foreground/50 hover:text-muted-foreground/70"
            onClick={() => setStatsExpanded(!statsExpanded)}
          >
            <span>
              Avg importance: {stats.avg_importance.toFixed(1)} | {stats.category_counts.length} categories
            </span>
            {statsExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {statsExpanded && (
            <div className="mt-1.5 space-y-0.5">
              {stats.category_counts.map(([cat, count]) => (
                <div key={cat} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground/60 capitalize">{cat}</span>
                  <span className="text-muted-foreground/40">{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
