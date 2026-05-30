import { forwardRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, SlidersHorizontal } from "lucide-react";
import { humanizeCategory } from "./ComposerConnectorCard";
import { useTranslation } from "@/i18n/useTranslation";
import { DebtText, debtText } from '@/i18n/DebtText';


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
      <div className="sticky top-0 z-10 bg-card-bg border-b border-border/20 px-5 py-3 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-foreground" />
            <input
              ref={ref}
              type="text"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder={debtText("auto_search_apps_5d1c8a02")}
              className="w-full pl-9 pr-3 py-2 rounded-interactive bg-foreground/5 border border-border/30 typo-body text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-primary/40"
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
                  ? "bg-primary/20 border-primary/50 text-foreground"
                  : "bg-foreground/5 border-border/30 text-foreground/85 hover:border-primary/30 hover:text-foreground"
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span className="typo-caption font-medium">
                {category === "__all__" ? t.agents.glyph_apps_filter : humanizeCategory(category)}
              </span>
            </button>
          )}
        </div>
        <AnimatePresence initial={false}>
          {filtersOpen && categories.length > 1 && (
            <motion.div
              key="filters"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                <button
                  type="button"
                  onClick={() => onCategoryChange("__all__")}
                  className={`px-2.5 py-1 rounded-full typo-caption transition-colors ${
                    category === "__all__"
                      ? "bg-primary/25 text-foreground border border-primary/50 font-medium"
                      : "bg-foreground/5 text-foreground border border-border/30 hover:border-primary/30"
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
                          ? "bg-primary/25 text-foreground border border-primary/50 font-medium"
                          : "bg-foreground/5 text-foreground border border-border/30 hover:border-primary/30"
                      }`}
                    >
                      {humanizeCategory(cat)} · {n}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  },
);
