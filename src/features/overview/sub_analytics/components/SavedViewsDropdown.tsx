import { useState, useEffect, useRef } from 'react';
import { Bookmark, Check, Plus, Trash2, X } from 'lucide-react';
import { listSavedViews, createSavedView, deleteSavedView, type SavedView } from '@/api/overview/savedViews';
import { log } from '@/lib/log';

interface SavedViewsDropdownProps {
  currentPersonaId: string | null;
  currentDayRange: number;
  currentCustomDateRange: [string, string] | null;
  currentCompareEnabled: boolean;
  onApplyPreset: (
    personaId: string | null,
    dayRange: number,
    customDateRange: [string, string] | null,
    compareEnabled: boolean
  ) => void;
}

const SMART_PRESETS = [
  {
    id: 'smart-this-week',
    name: 'This Week vs Last Week',
    persona_id: null,
    day_range: 7,
    custom_start_date: null,
    custom_end_date: null,
    compare_enabled: true,
    is_smart: true,
  },
  {
    id: 'smart-this-month',
    name: 'This Month vs Last Month',
    persona_id: null,
    day_range: 30,
    custom_start_date: null,
    custom_end_date: null,
    compare_enabled: true,
    is_smart: true,
  }
];

export function SavedViewsDropdown({
  currentPersonaId,
  currentDayRange,
  currentCustomDateRange,
  currentCompareEnabled,
  onApplyPreset,
}: SavedViewsDropdownProps) {
  const [views, setViews] = useState<SavedView[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [newViewName, setNewViewName] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const loadViews = async () => {
    try {
      const data = await listSavedViews();
      setViews(data);
    } catch (e) {
      log.error('SavedViewsDropdown', 'Failed to load saved views', { error: String(e) });
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadViews();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setIsSaving(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSave = async () => {
    if (!newViewName.trim()) return;
    try {
      await createSavedView({
        name: newViewName.trim(),
        persona_id: currentPersonaId || null,
        day_range: currentDayRange,
        custom_start_date: currentCustomDateRange ? currentCustomDateRange[0] : null,
        custom_end_date: currentCustomDateRange ? currentCustomDateRange[1] : null,
        compare_enabled: currentCompareEnabled,
        is_smart: false,
      });
      setNewViewName('');
      setIsSaving(false);
      await loadViews();
    } catch (e) {
      log.error('SavedViewsDropdown', 'Failed to save view', { operation: 'createSavedView', name: newViewName.trim(), error: String(e) });
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteSavedView(id);
      await loadViews();
    } catch (err) {
      log.error('SavedViewsDropdown', 'Failed to delete view', { operation: 'deleteSavedView', viewId: id, error: String(err) });
    }
  };

  const applyView = (v: {
    persona_id: string | null;
    day_range: number;
    custom_start_date: string | null;
    custom_end_date: string | null;
    compare_enabled: boolean;
  }) => {
    onApplyPreset(
      v.persona_id,
      v.day_range,
      v.custom_start_date && v.custom_end_date ? [v.custom_start_date, v.custom_end_date] : null,
      v.compare_enabled
    );
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium border bg-secondary/40 text-muted-foreground hover:bg-secondary/60 transition-all"
      >
        <Bookmark className="w-4 h-4" />
        <span className="hidden sm:inline">Saved Views</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-background border border-primary/20 rounded-xl shadow-lg z-50 overflow-hidden flex flex-col">
          {isSaving ? (
            <div className="p-2 flex items-center gap-2 border-b border-primary/10">
              <input
                autoFocus
                type="text"
                placeholder="View name..."
                className="flex-1 bg-transparent border border-primary/20 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-primary/50 text-foreground"
                value={newViewName}
                onChange={(e) => setNewViewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave();
                  if (e.key === 'Escape') setIsSaving(false);
                }}
              />
              <button onClick={handleSave} disabled={!newViewName.trim()} className="p-1.5 text-green-500 hover:bg-green-500/10 rounded disabled:opacity-50">
                <Check className="w-4 h-4" />
              </button>
              <button onClick={() => setIsSaving(false)} className="p-1.5 text-muted-foreground hover:bg-secondary rounded">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsSaving(true)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-primary hover:bg-primary/10 transition-colors text-left border-b border-primary/10"
            >
              <Plus className="w-4 h-4" />
              Save Current View
            </button>
          )}

          <div className="max-h-64 overflow-y-auto py-1">
            <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
              Smart Presets
            </div>
            {SMART_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => applyView(preset)}
                className="w-full px-3 py-1.5 text-sm text-foreground hover:bg-secondary text-left transition-colors"
              >
                {preset.name}
              </button>
            ))}

            {views.length > 0 && (
              <>
                <div className="px-3 py-1 mt-2 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold border-t border-primary/10 pt-2">
                  Your Saved Views
                </div>
                {views.map((view) => (
                  <div key={view.id} className="group flex items-center justify-between px-3 py-1.5 hover:bg-secondary transition-colors cursor-pointer" onClick={() => applyView(view)}>
                    <span className="text-sm text-foreground truncate flex-1 pr-2">{view.name}</span>
                    <button
                      onClick={(e) => handleDelete(view.id, e)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-destructive/70 hover:text-destructive hover:bg-destructive/10 rounded transition-all flex-shrink-0"
                      title="Delete view"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
