import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, SlidersHorizontal, AlertTriangle } from 'lucide-react';
import type {
  FilterState,
  StatusFilter,
  ModelFilter,
  HealthFilter,
  RecencyFilter,
  SmartTag,
} from './usePersonaFilters';

// ── Filter chip config ───────────────────────────────────────────────

interface ChipOption<T extends string> {
  value: T;
  label: string;
}

const STATUS_OPTIONS: ChipOption<StatusFilter>[] = [
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
];

const MODEL_OPTIONS: ChipOption<ModelFilter>[] = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'litellm', label: 'LiteLLM' },
  { value: 'custom', label: 'Custom' },
  { value: 'default', label: 'Default' },
];

const HEALTH_OPTIONS: ChipOption<HealthFilter>[] = [
  { value: 'healthy', label: 'Healthy' },
  { value: 'degraded', label: 'Degraded' },
  { value: 'failing', label: 'Failing' },
  { value: 'dormant', label: 'Dormant' },
  { value: 'needs-attention', label: 'Needs Attention' },
];

const RECENCY_OPTIONS: ChipOption<RecencyFilter>[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'stale', label: 'Stale' },
];

// ── Chip Component ───────────────────────────────────────────────────

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
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
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

// ── Chip Group ───────────────────────────────────────────────────────

function ChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ChipOption<T>[];
  value: T | 'all';
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-xs text-muted-foreground/60 font-medium mr-0.5 min-w-[52px]">{label}</span>
      {options.map((opt) => (
        <FilterChip
          key={opt.value}
          label={opt.label}
          active={value === opt.value}
          onClick={() => onChange(opt.value)}
        />
      ))}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────

interface SearchFilterBarProps {
  filters: FilterState;
  hasActiveFilters: boolean;
  matchCount: number;
  totalCount: number;
  allTags: SmartTag[];
  onSearchChange: (value: string) => void;
  onStatusChange: (value: StatusFilter) => void;
  onModelChange: (value: ModelFilter) => void;
  onHealthChange: (value: HealthFilter) => void;
  onRecencyChange: (value: RecencyFilter) => void;
  onTagChange: (value: string | null) => void;
  onClear: () => void;
}

export function SearchFilterBar({
  filters,
  hasActiveFilters,
  matchCount,
  totalCount,
  allTags,
  onSearchChange,
  onStatusChange,
  onModelChange,
  onHealthChange,
  onRecencyChange,
  onTagChange,
  onClear,
}: SearchFilterBarProps) {
  const [showFilters, setShowFilters] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-expand filters when a non-search filter is active
  useEffect(() => {
    if (hasActiveFilters && filters.search === '' && !showFilters) {
      // Don't auto-expand, let user toggle
    }
  }, [hasActiveFilters, filters.search, showFilters]);

  return (
    <div className="mb-2 space-y-1.5">
      {/* Search row */}
      <div className="flex items-center gap-1.5">
        <div className="flex-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-primary/10 bg-secondary/30 focus-within:border-primary/25 focus-within:bg-secondary/50 transition-all">
          <Search className="w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={filters.search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search agents..."
            className="flex-1 min-w-0 text-sm bg-transparent border-none outline-none text-foreground/90 placeholder:text-muted-foreground/40"
          />
          {filters.search && (
            <button
              onClick={() => onSearchChange('')}
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
          <span className="text-xs text-muted-foreground/60">
            {matchCount} of {totalCount} agents
          </span>
          <button
            onClick={onClear}
            className="text-xs text-primary/70 hover:text-primary transition-colors"
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
              <ChipGroup
                label="Status"
                options={STATUS_OPTIONS}
                value={filters.status}
                onChange={onStatusChange}
              />
              <ChipGroup
                label="Model"
                options={MODEL_OPTIONS}
                value={filters.model}
                onChange={onModelChange}
              />
              <ChipGroup
                label="Health"
                options={HEALTH_OPTIONS}
                value={filters.health}
                onChange={onHealthChange}
              />
              <ChipGroup
                label="Recency"
                options={RECENCY_OPTIONS}
                value={filters.recency}
                onChange={onRecencyChange}
              />

              {/* Smart tags */}
              {allTags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-xs text-muted-foreground/60 font-medium mr-0.5 min-w-[52px]">Tags</span>
                  {allTags.map((tag) => (
                    <FilterChip
                      key={tag.id}
                      label={tag.label}
                      active={filters.tag === tag.id}
                      onClick={() => onTagChange(tag.id)}
                      color={tag.color}
                    />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* "Needs attention" quick filter (always visible when there are issues) */}
      {!showFilters && allTags.some(t => t.id === 'auto:needs-attention') && filters.health !== 'needs-attention' && (
        <button
          onClick={() => onHealthChange('needs-attention')}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-amber-400/80 hover:text-amber-400 bg-amber-500/5 hover:bg-amber-500/10 border border-amber-500/10 hover:border-amber-500/20 transition-all w-full"
        >
          <AlertTriangle className="w-3 h-3" />
          <span>Agents need attention</span>
        </button>
      )}
    </div>
  );
}
