import { useState } from 'react';
import { Search, Bookmark, BookmarkX, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
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
  /** Resolves true once the view exists; false keeps the name field open. */
  saveCurrentView: (name: string) => Promise<boolean>;
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
    if (!(await saveCurrentView(viewName.trim()))) return;
    setViewName('');
    setShowSaveDialog(false);
  };

  return (
    <div className="px-4 pb-2 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-3" />
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder={t.overview.events.search_placeholder}
            className="w-full pl-8 pr-8 h-[var(--control-h)] typo-body rounded-interactive bg-surface-1 border border-hair text-ink-1 placeholder:text-ink-3 focus:outline-none focus:border-hair-2 transition-colors"
          />
          {searchText && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setSearchText('')}
              aria-label={t.common.clear}
              className="absolute right-0.5 top-1/2 -translate-y-1/2"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
        {isSearching && <LoadingSpinner size="xs" />}
        {hasActiveFilters && (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowSaveDialog(true)}
              className="whitespace-nowrap"
              tooltip={debtText("auto_save_current_filters_as_a_view_1680b016")}
              icon={<Bookmark className="w-3 h-3" />}
            >
              {t.overview.events.save_view}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="whitespace-nowrap"
              tooltip={debtText("auto_clear_all_filters_7dd6d199")}
              icon={<X className="w-3 h-3" />}
            >
              {t.common.clear}
            </Button>
          </>
        )}
      </div>

      {/* Saved views chips */}
      {savedViews.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="typo-eyebrow text-ink-3">{t.overview.events.views_label}</span>
          {/* Each chip is a group of two SIBLING buttons. The delete control
              used to be a <button> nested inside the apply <button> (invalid
              HTML: browsers and screen readers flatten it) and was visible only
              on mouse hover, so a keyboard user could never reach it. */}
          {savedViews.map((view) => (
            <span
              key={view.id}
              className={`group inline-flex items-center gap-0.5 rounded-interactive border border-hair ${activeViewId === view.id ? 'bg-sel' : 'bg-surface-1'}`}
            >
              <Button
                variant="ghost"
                size="xs"
                onClick={() => applySavedView(view)}
                aria-pressed={activeViewId === view.id}
                icon={<Bookmark className="w-2.5 h-2.5" />}
              >
                {view.name}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => removeSavedView(view.id)}
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                tooltip={t.overview.events.delete_view}
                aria-label={`${t.overview.events.delete_view}: ${view.name}`}
              >
                <BookmarkX className="w-2.5 h-2.5" />
              </Button>
            </span>
          ))}
        </div>
      )}

      {/* Save view dialog */}
      {showSaveDialog && (
        <div className="flex items-center gap-2 p-2 rounded-card bg-surface-1 border border-hair">
          <input
            type="text"
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
            placeholder={t.overview.events.view_name_placeholder}
            className="flex-1 px-2 h-[var(--control-h)] typo-body rounded-interactive bg-background/50 border border-hair text-ink-1 placeholder:text-ink-3 focus:outline-none focus:border-hair-2"
            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveView(); if (e.key === 'Escape') setShowSaveDialog(false); }}
            autoFocus
          />
          <Button variant="primary" size="sm" onClick={handleSaveView} disabled={!viewName.trim()}>
            {t.common.save}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setShowSaveDialog(false); setViewName(''); }}>
            {t.common.cancel}
          </Button>
        </div>
      )}
    </div>
  );
}
