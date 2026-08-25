import { useState } from 'react';
import { Search, Bookmark, BookmarkX, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { SavedView } from '@/lib/bindings/SavedView';
import { debtText } from '@/i18n/DebtText';

export interface EventLogToolbarProps {
  searchText: string;
  setSearchText: (v: string) => void;
  isSearching: boolean;
  hasActiveFilters: boolean;
  clearFilters: () => void;
  savedViews: SavedView[];
  activeViewId: string | null;
  saveCurrentView: (name: string) => Promise<void>;
  applySavedView: (view: SavedView) => void;
  removeSavedView: (viewId: string) => void;
}

/**
 * Search bar + saved-views strip for the event log — extracted from
 * EventLogList so the list component stays at orchestration altitude.
 * Owns only the save-dialog's local UI state; all filter/search state
 * lives in useEventLog and flows in via props.
 */
export function EventLogToolbar({
  searchText, setSearchText, isSearching,
  hasActiveFilters, clearFilters,
  savedViews, activeViewId, saveCurrentView, applySavedView, removeSavedView,
}: EventLogToolbarProps) {
  const { t } = useTranslation();
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [viewName, setViewName] = useState('');

  const handleSaveView = async () => {
    if (!viewName.trim()) return;
    await saveCurrentView(viewName.trim());
    setViewName('');
    setShowSaveDialog(false);
  };

  return (
    <div className="px-4 pb-2 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground" />
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder={t.overview.events.search_placeholder}
            className="w-full pl-8 pr-8 py-1.5 typo-body rounded-card bg-secondary/30 border border-primary/10 text-foreground placeholder:text-foreground focus:outline-none focus:border-primary/30 transition-colors"
          />
          {searchText && (
            <button
              type="button"
              onClick={() => setSearchText('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-foreground hover:text-foreground/70"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {isSearching && <LoadingSpinner size="xs" />}
        {hasActiveFilters && (
          <>
            <button
              type="button"
              onClick={() => setShowSaveDialog(true)}
              className="flex items-center gap-1 px-2 py-1.5 typo-caption rounded-card bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors whitespace-nowrap"
              title={debtText("auto_save_current_filters_as_a_view_1680b016")}
            >
              <Bookmark className="w-3 h-3" /> {t.overview.events.save_view}
            </button>
            <button
              type="button"
              onClick={clearFilters}
              className="flex items-center gap-1 px-2 py-1.5 typo-caption rounded-card bg-secondary/40 text-foreground border border-primary/10 hover:bg-secondary/60 transition-colors whitespace-nowrap"
              title={debtText("auto_clear_all_filters_7dd6d199")}
            >
              <X className="w-3 h-3" /> {t.common.clear}
            </button>
          </>
        )}
      </div>

      {/* Saved views chips */}
      {savedViews.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="typo-caption text-foreground">{t.overview.events.views_label}</span>
          {savedViews.map((view) => (
            <button
              type="button"
              key={view.id}
              onClick={() => applySavedView(view)}
              className={`group flex items-center gap-1 px-2 py-0.5 typo-caption rounded-card border transition-colors ${activeViewId === view.id
                  ? 'bg-primary/15 text-primary border-primary/30'
                  : 'bg-secondary/30 text-foreground border-primary/10 hover:bg-secondary/50'
                }`}
            >
              <Bookmark className="w-2.5 h-2.5" />
              {view.name}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removeSavedView(view.id); }}
                className="ml-0.5 opacity-0 group-hover:opacity-100 text-foreground hover:text-status-error transition-opacity"
                title={t.overview.events.delete_view}
              >
                <BookmarkX className="w-2.5 h-2.5" />
              </button>
            </button>
          ))}
        </div>
      )}

      {/* Save view dialog */}
      {showSaveDialog && (
        <div className="flex items-center gap-2 p-2 rounded-card bg-secondary/40 border border-primary/10">
          <input
            type="text"
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
            placeholder={t.overview.events.view_name_placeholder}
            className="flex-1 px-2 py-1 typo-body rounded bg-background/50 border border-primary/10 text-foreground placeholder:text-foreground focus:outline-none focus:border-primary/30"
            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveView(); if (e.key === 'Escape') setShowSaveDialog(false); }}
            autoFocus
          />
          <button
            type="button"
            onClick={handleSaveView}
            disabled={!viewName.trim()}
            className="px-3 py-1 typo-caption rounded-card bg-primary/15 text-primary border border-primary/25 hover:bg-primary/25 disabled:opacity-40 transition-colors"
          >
            {t.common.save}
          </button>
          <button
            type="button"
            onClick={() => { setShowSaveDialog(false); setViewName(''); }}
            className="px-2 py-1 typo-caption rounded-card text-foreground hover:text-foreground transition-colors"
          >
            {t.common.cancel}
          </button>
        </div>
      )}
    </div>
  );
}
