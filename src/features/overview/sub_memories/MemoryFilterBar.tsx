import { Search, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { MEMORY_CATEGORY_COLORS, ALL_MEMORY_CATEGORIES } from '@/lib/utils/formatters';
import type { DbPersona } from '@/lib/types/types';

export interface MemoryFilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  selectedPersonaId: string | null;
  onPersonaChange: (value: string | null) => void;
  selectedCategory: string | null;
  onCategoryChange: (value: string | null) => void;
  hasFilters: boolean;
  onClearFilters: () => void;
  personas: DbPersona[];
}

export function MemoryFilterBar({
  search,
  onSearchChange,
  selectedPersonaId,
  onPersonaChange,
  selectedCategory,
  onCategoryChange,
  hasFilters,
  onClearFilters,
  personas,
}: MemoryFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Search */}
      <div className="relative flex-1 min-w-[180px] max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/80" />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search memories..."
          className="w-full pl-9 pr-3 py-2 text-sm bg-secondary/50 border border-primary/15 rounded-lg outline-none focus:border-primary/30 text-foreground/80 placeholder:text-muted-foreground/80"
        />
      </div>

      {/* Persona filter */}
      <select
        value={selectedPersonaId || ''}
        onChange={(e) => onPersonaChange(e.target.value || null)}
        className="px-3 py-2 text-sm bg-secondary/50 border border-primary/15 rounded-lg outline-none text-foreground/90 appearance-none cursor-pointer min-w-[130px]"
      >
        <option value="">All agents</option>
        {personas.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>

      {/* Category filter chips */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={() => onCategoryChange(null)}
          className={`relative px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
            selectedCategory === null
              ? 'bg-primary/15 text-primary border-primary/30'
              : 'bg-secondary/30 text-muted-foreground/80 border-primary/15 hover:text-muted-foreground hover:bg-secondary/50'
          }`}
        >
          {selectedCategory === null && (
            <motion.div
              layoutId="category-chip-active"
              className="absolute inset-0 rounded-lg bg-primary/15 border border-primary/30"
              transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
            />
          )}
          <span className="relative">All</span>
        </button>
        {ALL_MEMORY_CATEGORIES.map((cat) => {
          const defaultColors = { label: cat, bg: 'bg-gray-500/10', text: 'text-gray-400', border: 'border-gray-500/20' };
          const colors = MEMORY_CATEGORY_COLORS[cat] ?? defaultColors;
          const isActive = selectedCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => onCategoryChange(isActive ? null : cat)}
              className={`relative flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
                isActive
                  ? `${colors.bg} ${colors.text} ${colors.border}`
                  : 'bg-secondary/30 text-muted-foreground/80 border-primary/15 hover:text-muted-foreground hover:bg-secondary/50'
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="category-chip-active"
                  className={`absolute inset-0 rounded-lg ${colors.bg} border ${colors.border}`}
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
                />
              )}
              <span className={`relative w-2 h-2 rounded-full ${isActive ? colors.text.replace('text-', 'bg-') : 'bg-muted-foreground/30'}`} />
              <span className="relative">{colors.label}</span>
            </button>
          );
        })}
      </div>

      {/* Clear filters */}
      {hasFilters && (
        <button
          onClick={onClearFilters}
          className="flex items-center gap-1 px-2.5 py-2 text-sm text-muted-foreground/90 hover:text-foreground/95 rounded-lg hover:bg-secondary/40 transition-colors"
        >
          <X className="w-3 h-3" />
          Clear
        </button>
      )}
    </div>
  );
}
