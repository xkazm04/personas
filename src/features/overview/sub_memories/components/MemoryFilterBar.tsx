import { useTranslation } from '@/i18n/useTranslation';
import { Search, X } from 'lucide-react';
import { MEMORY_CATEGORY_COLORS, ALL_MEMORY_CATEGORIES } from '@/lib/utils/formatters';
import type { Persona } from '@/lib/types/types';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';

export interface MemoryFilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  selectedPersonaId: string | null;
  onPersonaChange: (value: string | null) => void;
  selectedCategory: string | null;
  onCategoryChange: (value: string | null) => void;
  hasFilters: boolean;
  onClearFilters: () => void;
  personas: Persona[];
}

export function MemoryFilterBar({
  search, onSearchChange, selectedPersonaId, onPersonaChange,
  selectedCategory, onCategoryChange, hasFilters, onClearFilters, personas,
}: MemoryFilterBarProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[180px] max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground" />
        <input value={search} onChange={(e) => onSearchChange(e.target.value)} placeholder={t.overview.memory_filter.search_placeholder} className="w-full pl-9 pr-3 py-2 typo-body bg-secondary/50 border border-primary/15 rounded-modal outline-none focus-visible:border-primary/30 text-foreground placeholder:text-foreground" />
      </div>

      <ThemedSelect value={selectedPersonaId || ''} onChange={(e) => onPersonaChange(e.target.value || null)} wrapperClassName="min-w-[130px]">
        <option value="">{t.overview.memory_filter.all_agents}</option>
        {personas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </ThemedSelect>

      <ThemedSelect
        value={selectedCategory || ''}
        onChange={(e) => onCategoryChange(e.target.value || null)}
        wrapperClassName="min-w-[130px]"
      >
        <option value="">{t.overview.memory_filter.all_categories}</option>
        {ALL_MEMORY_CATEGORIES.map((cat) => {
          const colors = MEMORY_CATEGORY_COLORS[cat] ?? { label: cat };
          return <option key={cat} value={cat}>{colors.label}</option>;
        })}
      </ThemedSelect>

      {hasFilters && (
        <button onClick={onClearFilters} className="flex items-center gap-1 px-2.5 py-2 typo-body text-foreground hover:text-foreground/95 rounded-modal hover:bg-secondary/40 transition-colors">
          <X className="w-3 h-3" />
          {t.common.clear}
        </button>
      )}
    </div>
  );
}
