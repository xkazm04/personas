import { motion } from 'framer-motion';
import { Search, LayoutGrid, List, X } from 'lucide-react';

interface ToolSearchFilterProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  viewMode: 'grid' | 'grouped';
  onViewModeChange: (mode: 'grid' | 'grouped') => void;
  categories: string[];
  categoryCounts: Map<string, number>;
  selectedCategory: string;
  onCategoryChange: (category: string) => void;
  isSearching: boolean;
  assignedTools: Array<{ id: string; name: string }>;
  totalToolCount: number;
  onClearAll: () => void;
}

export function ToolSearchFilter({
  searchQuery,
  onSearchChange,
  viewMode,
  onViewModeChange,
  categories,
  categoryCounts,
  selectedCategory,
  onCategoryChange,
  isSearching,
  assignedTools,
  totalToolCount,
  onClearAll,
}: ToolSearchFilterProps) {
  return (
    <>
      {/* Search Input + View Toggle */}
      <div className="flex items-center gap-2">
        <div className="relative max-w-[280px] flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/90" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search tools..."
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-primary/20 bg-secondary/25 text-sm text-foreground placeholder-muted-foreground/40 focus-ring"
          />
        </div>
        <div className="flex gap-0.5 p-0.5 rounded-lg bg-secondary/40 border border-primary/10">
          <button
            onClick={() => onViewModeChange('grid')}
            className={`p-1.5 rounded-lg transition-all ${
              viewMode === 'grid'
                ? 'bg-primary/15 text-foreground/80'
                : 'text-muted-foreground/80 hover:text-foreground/95'
            }`}
            title="Category view"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onViewModeChange('grouped')}
            className={`p-1.5 rounded-lg transition-all ${
              viewMode === 'grouped'
                ? 'bg-primary/15 text-foreground/80'
                : 'text-muted-foreground/80 hover:text-foreground/95'
            }`}
            title="Connector view"
          >
            <List className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Category Filter (grid mode only) */}
      <div className={`flex items-center gap-2 flex-wrap transition-opacity ${viewMode !== 'grid' ? 'hidden' : isSearching ? 'opacity-40 pointer-events-none' : ''}`}>
        {categories.map((category) => (
          <button
            key={category}
            onClick={() => { onCategoryChange(category); onSearchChange(''); }}
            className={`relative flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm font-medium transition-all ${
              selectedCategory === category
                ? 'text-foreground shadow-lg shadow-primary/20'
                : 'bg-secondary/40 text-muted-foreground/80 hover:bg-secondary/60 hover:text-foreground/95 border border-primary/20'
            }`}
          >
            {selectedCategory === category && (
              <motion.div
                layoutId="tool-category-pill"
                className="absolute inset-0 rounded-xl bg-primary"
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              />
            )}
            <span className="relative z-10">{category}</span>
            <span className={`text-sm px-1.5 py-0.5 rounded-full font-bold ${
              selectedCategory === category
                ? 'relative z-10 bg-foreground/15 text-foreground/90'
                : 'bg-muted/30 text-muted-foreground/80'
            }`}>
              {categoryCounts.get(category) ?? 0}
            </span>
          </button>
        ))}
      </div>

      {/* Assigned tools summary bar */}
      {assignedTools.length > 0 && (
        <div className="flex items-center gap-2 bg-primary/5 border border-primary/10 rounded-xl px-4 py-2">
          <span className="text-sm text-muted-foreground/80 flex-shrink-0">
            <span className="font-semibold text-foreground/90">{assignedTools.length}</span> of {totalToolCount} tools assigned
          </span>
          <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden ml-2">
            {assignedTools.slice(0, 5).map((tool) => (
              <span
                key={tool.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-sm bg-primary/10 text-foreground/90 border border-primary/20 truncate max-w-[120px] flex-shrink-0"
              >
                {tool.name}
              </span>
            ))}
            {assignedTools.length > 5 && (
              <span className="text-sm text-muted-foreground/80 flex-shrink-0">
                +{assignedTools.length - 5} more
              </span>
            )}
          </div>
          <button
            onClick={onClearAll}
            className="flex-shrink-0 text-sm text-muted-foreground/90 hover:text-red-400 transition-colors flex items-center gap-1"
          >
            <X className="w-3 h-3" />
            Clear all
          </button>
        </div>
      )}
    </>
  );
}
