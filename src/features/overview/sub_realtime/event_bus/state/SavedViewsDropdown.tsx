import { useState } from 'react';
import { X, Bookmark, Plus } from 'lucide-react';
import { FilterDropdown } from './FilterDropdown';
import type { SavedView } from './eventBusFilterTypes';

interface SavedViewsDropdownProps {
  savedViews: SavedView[];
  activeViewId: string | null;
  onApplyView: (view: SavedView) => void;
  onSaveView: (name: string) => void;
  onDeleteView: (id: string) => void;
  hasActiveFilter: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}

export function SavedViewsDropdown({
  savedViews,
  activeViewId,
  onApplyView,
  onSaveView,
  onDeleteView,
  hasActiveFilter,
  isOpen,
  onToggle,
  onClose,
}: SavedViewsDropdownProps) {
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState('');

  const handleSave = () => {
    const name = saveName.trim();
    if (!name) return;
    onSaveView(name);
    setSaveName('');
    setSaveDialogOpen(false);
  };

  return (
    <FilterDropdown
      label="Views"
      icon={<Bookmark className="w-3 h-3" />}
      activeCount={activeViewId ? 1 : 0}
      isOpen={isOpen}
      onToggle={onToggle}
      wide
    >
      {savedViews.length === 0 && !saveDialogOpen && (
        <p className="text-xs text-muted-foreground/50 px-2 py-1.5">No saved views yet</p>
      )}
      {savedViews.map((view) => (
        <div
          key={view.id}
          className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${
            activeViewId === view.id ? 'bg-primary/10 text-primary' : 'hover:bg-secondary/40 text-foreground/80'
          }`}
          onClick={() => { onApplyView(view); onClose(); }}
        >
          <span className="text-sm truncate">{view.name}</span>
          <button
            onClick={(e) => { e.stopPropagation(); onDeleteView(view.id); }}
            className="p-0.5 rounded hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-400 transition-colors"
            title="Delete saved view"
            aria-label={`Delete view ${view.name}`}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
      {saveDialogOpen ? (
        <div className="flex items-center gap-1.5 mt-1 pt-1.5 border-t border-primary/8">
          <input
            type="text"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            placeholder="View name..."
            autoFocus
            className="flex-1 px-2 py-1 text-sm rounded border border-primary/15 bg-background/40 text-foreground placeholder-muted-foreground/30 focus-ring"
          />
          <button
            onClick={handleSave}
            disabled={!saveName.trim()}
            className="px-2 py-1 text-xs rounded bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 transition-colors"
          >
            Save
          </button>
          <button
            onClick={() => { setSaveDialogOpen(false); setSaveName(''); }}
            className="p-1 rounded hover:bg-secondary/40 text-muted-foreground/50"
            title="Cancel"
            aria-label="Cancel saving view"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        hasActiveFilter && (
          <button
            onClick={() => setSaveDialogOpen(true)}
            className="flex items-center gap-1.5 w-full px-2 py-1.5 mt-1 pt-1.5 border-t border-primary/8 text-sm text-primary hover:bg-primary/5 rounded-md transition-colors"
          >
            <Plus className="w-3 h-3" />
            Save current filter
          </button>
        )
      )}
    </FilterDropdown>
  );
}
