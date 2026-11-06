import { forwardRef } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { humanizeCategory } from "./ComposerConnectorCard";
import { useTranslation } from "@/i18n/useTranslation";
import { DebtText, debtText } from '@/i18n/DebtText';
import { Collapse } from '@/features/shared/components/display/Collapse';


interface CategoryEntry {
  cat: string;
  n: number;
}

interface ComposerConnectorsSearchBarProps {
  query: string;
  onQueryChange: (v: string) => void;
  categories: CategoryEntry[];
  totalHealthy: number;
  category: string;
  onCategoryChange: (cat: string) => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
}

export const ComposerConnectorsSearchBar = forwardRef<HTMLInputElement, ComposerConnectorsSearchBarProps>(
  function ComposerConnectorsSearchBar({
    query, onQueryChange, categories, totalHealthy, category, onCategoryChange,
    filtersOpen, onToggleFilters,
  }, ref) {
    const { t } = useTranslation();
    return (
      <div className="sticky top-0 z-10 bg-card-bg border-b border-hair px-5 py-3 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-1" />
            <input
              ref={ref}
              type="text"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder={debtText("auto_search_apps_5d1c8a02")}
              className="w-full pl-9 pr-3 py-2 rounded-interactive bg-surface-1 border border-hair typo-body text-ink-1 placeholder:text-ink-3 focus:outline-none focus:border-primary/40"
            />
          </div>
          {categories.length > 1 && (
            <button
              type="button"
              onClick={onToggleFilters}
              aria-pressed={filtersOpen}
              title={filtersOpen ? t.agents.glyph_apps_hide_filters : t.agents.glyph_apps_show_filters}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-interactive border transition-colors ${
                filtersOpen || category !== "__all__"
                  ? "bg-primary/20 border-primary/50 text-ink-1"
                  : "bg-surface-1 border-hair text-ink-1 hover:border-primary/30 hover:text-ink-1"
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span className="typo-caption">
                {category === "__all__" ? t.agents.glyph_apps_filter : humanizeCategory(category)}
              </span>
            </button>
          )}
        </div>
        <Collapse open={filtersOpen && categories.length > 1} unmountWhenClosed duration={180}>
          <div className="flex items-center gap-1.5 flex-wrap pt-1">
            <button
              type="button"
              onClick={() => onCategoryChange("__all__")}
              className={`px-2.5 py-1 rounded-full typo-caption transition-colors ${
                category === "__all__"
                  ? "bg-primary/25 text-ink-1 border border-primary/50"
                  : "bg-surface-1 text-ink-1 border border-hair hover:border-primary/30"
              }`}
            >
              <DebtText k="auto_all_c8fb9db1" /> {totalHealthy}
            </button>
            {categories.map(({ cat, n }) => {
              const active = category === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => onCategoryChange(cat)}
                  className={`px-2.5 py-1 rounded-full typo-caption transition-colors ${
                    active
                      ? "bg-primary/25 text-ink-1 border border-primary/50"
                      : "bg-surface-1 text-ink-1 border border-hair hover:border-primary/30"
                  }`}
                >
                  {humanizeCategory(cat)} · {n}
                </button>
              );
            })}
          </div>
        </Collapse>
      </div>
    );
  },
);
