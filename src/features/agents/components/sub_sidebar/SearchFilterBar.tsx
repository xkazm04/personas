import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, SlidersHorizontal, AlertTriangle } from 'lucide-react';
import { TAG_GROUPS } from './usePersonaFilters';
import type { FilterState, SmartTag } from './usePersonaFilters';

// -- Chip Component ---------------------------------------------------

function FilterChip({
  label,
  active,
  onClick,
  color,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
        active
          ? 'bg-primary/15 text-primary border border-primary/30'
          : 'bg-secondary/40 text-muted-foreground/80 border border-transparent hover:bg-secondary/60 hover:text-muted-foreground'
      }`}
      style={
        active && color
          ? { backgroundColor: `${color}20`, color, borderColor: `${color}40` }
          : undefined
      }
    >
      {label}
    </button>
  );
}

// -- Tag Group Row ---------------------------------------------------

function TagGroupRow({
  label,
  tags,
  activeTags,
  onToggle,
}: {
  label: string;
  tags: SmartTag[];
  activeTags: Set<string>;
  onToggle: (tagId: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-sm text-muted-foreground/60 font-medium mr-0.5 min-w-[52px]">{label}</span>
      {tags.map((tag) => (
        <FilterChip
          key={tag.id}
          label={tag.label}
          active={activeTags.has(tag.id)}
          onClick={() => onToggle(tag.id)}
          color={tag.color}
        />
      ))}
    </div>
  );
}

// -- Main Component ---------------------------------------------------

interface SearchFilterBarProps {
  filters: FilterState;
  hasActiveFilters: boolean;
  matchCount: number;
  totalCount: number;
  allAutoTags: SmartTag[];
  onSearchChange: (value: string) => void;
  onToggleTag: (tagId: string) => void;
  onClear: () => void;
}

export function SearchFilterBar({
  filters,
  hasActiveFilters,
  matchCount,
  totalCount,
  allAutoTags,
  onSearchChange,
  onToggleTag,
  onClear,
}: SearchFilterBarProps) {
  const [showFilters, setShowFilters] = useState(false);
  const [localSearch, setLocalSearch] = useState(filters.search);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLocalSearch(filters.search);
  }, [filters.search]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (localSearch !== filters.search) {
        onSearchChange(localSearch);
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [localSearch, filters.search, onSearchChange]);

  const activeTags = filters.tags;

  return (
    <div className="mb-2 space-y-1.5">
      {/* Search row */}
      <div className="flex items-center gap-1.5">
        <div className="flex-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-primary/10 bg-secondary/30 focus-within:border-primary/30 focus-within:bg-secondary/50 transition-all">
          <Search className="w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder="Search agents..."
            className="flex-1 min-w-0 text-sm bg-transparent border-none outline-none text-foreground/90 placeholder:text-muted-foreground/40"
          />
          {localSearch && (
            <button
              onClick={() => {
                setLocalSearch('');
                onSearchChange('');
              }}
              className="p-0.5 rounded hover:bg-secondary/60"
            >
              <X className="w-3 h-3 text-muted-foreground/60" />
            </button>
          )}
        </div>

        {/* Filter toggle */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`p-1.5 rounded-lg border transition-all ${
            showFilters || (hasActiveFilters && filters.search === '')
              ? 'bg-primary/10 border-primary/20 text-primary'
              : 'border-transparent text-muted-foreground/50 hover:text-muted-foreground/80 hover:bg-secondary/40'
          }`}
          title="Toggle filters"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Active filter summary / clear */}
      {hasActiveFilters && (
        <div className="flex items-center justify-between px-1">
          <span className="text-sm text-muted-foreground/60">
            {matchCount} of {totalCount} agents
          </span>
          <button
            onClick={onClear}
            className="text-sm text-primary/70 hover:text-primary transition-colors"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Expandable filter panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="space-y-1.5 p-2 rounded-lg border border-primary/10 bg-secondary/20">
              {TAG_GROUPS.map((group) => (
                <TagGroupRow
                  key={group.category}
                  label={group.label}
                  tags={group.tags}
                  activeTags={activeTags}
                  onToggle={onToggleTag}
                />
              ))}

              {/* Auto/smart tags */}
              {allAutoTags.length > 0 && (
                <TagGroupRow
                  label="Tags"
                  tags={allAutoTags}
                  activeTags={activeTags}
                  onToggle={onToggleTag}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* "Needs attention" quick filter (always visible when there are issues) */}
      {!showFilters && allAutoTags.some(t => t.id === 'auto:needs-attention') && !activeTags.has('health:needs-attention') && (
        <button
          onClick={() => onToggleTag('health:needs-attention')}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-sm text-amber-400/80 hover:text-amber-400 bg-amber-500/5 hover:bg-amber-500/10 border border-amber-500/10 hover:border-amber-500/20 transition-all w-full"
        >
          <AlertTriangle className="w-3 h-3" />
          <span>Agents need attention</span>
        </button>
      )}
    </div>
  );
}
