import { useState, useEffect, useRef, useCallback } from 'react';
import { Bookmark, Check, Plus, Trash2, X, ChevronDown, Sparkles } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import { listSavedViewsByType, createSavedView, deleteSavedView, type SavedView } from '@/api/overview/savedViews';
import { log } from '@/lib/log';
import { errMsg } from '@/stores/storeTypes';

/** The filter/sort/grouping state persisted in view_config JSON. */
export interface AgentListViewConfig {
  statusFilter: string;
  healthFilter: string;
  connectorFilter: string;
  favoriteOnly: boolean;
  sortKey: string | null;
  sortDirection: 'asc' | 'desc';
}

export const DEFAULT_VIEW_CONFIG: AgentListViewConfig = {
  statusFilter: 'all',
  healthFilter: 'all',
  connectorFilter: 'all',
  favoriteOnly: false,
  sortKey: 'lastRun',
  sortDirection: 'desc',
};

interface SmartPreset {
  id: string;
  name: string;
  config: AgentListViewConfig;
}

const SMART_PRESETS: SmartPreset[] = [
  {
    id: 'smart-active-healthy',
    name: 'Active & Healthy',
    config: { statusFilter: 'enabled', healthFilter: 'healthy', connectorFilter: 'all', favoriteOnly: false, sortKey: 'name', sortDirection: 'asc' },
  },
  {
    id: 'smart-needs-attention',
    name: 'Needs Attention',
    config: { statusFilter: 'all', healthFilter: 'degraded', connectorFilter: 'all', favoriteOnly: false, sortKey: 'lastRun', sortDirection: 'desc' },
  },
  {
    id: 'smart-failing',
    name: 'Failing Agents',
    config: { statusFilter: 'all', healthFilter: 'failing', connectorFilter: 'all', favoriteOnly: false, sortKey: 'lastRun', sortDirection: 'desc' },
  },
  {
    id: 'smart-favorites',
    name: 'My Favorites',
    config: { statusFilter: 'all', healthFilter: 'all', connectorFilter: 'all', favoriteOnly: true, sortKey: 'name', sortDirection: 'asc' },
  },
  {
    id: 'smart-recently-run',
    name: 'Recently Active',
    config: { statusFilter: 'enabled', healthFilter: 'all', connectorFilter: 'all', favoriteOnly: false, sortKey: 'lastRun', sortDirection: 'desc' },
  },
];

interface ViewPresetBarProps {
  currentConfig: AgentListViewConfig;
  onApplyConfig: (config: AgentListViewConfig) => void;
}

export function ViewPresetBar({ currentConfig, onApplyConfig }: ViewPresetBarProps) {
  const { t } = useTranslation();
  const [views, setViews] = useState<SavedView[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [newViewName, setNewViewName] = useState('');
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const loadViews = useCallback(async () => {
    try {
      const data = await listSavedViewsByType('agent_list');
      setViews(data);
    } catch (e) {
      log.error('ViewPresetBar', 'Failed to load views', { error: errMsg(e, 'Failed to load views') });
    }
  }, []);

  useEffect(() => {
    loadViews();
  }, [loadViews]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setIsSaving(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const handleSave = async () => {
    if (!newViewName.trim()) return;
    try {
      const view = await createSavedView({
        name: newViewName.trim(),
        persona_id: null,
        day_range: 0,
        custom_start_date: null,
        custom_end_date: null,
        compare_enabled: false,
        is_smart: false,
        view_type: 'agent_list',
        view_config: JSON.stringify(currentConfig),
      });
      setNewViewName('');
      setIsSaving(false);
      setActiveViewId(view.id);
      await loadViews();
    } catch (e) {
      log.error('ViewPresetBar', 'Failed to save view', { error: errMsg(e, 'Failed to save view') });
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteSavedView(id);
      if (activeViewId === id) setActiveViewId(null);
      await loadViews();
    } catch (err) {
      log.error('ViewPresetBar', 'Failed to delete view', { error: errMsg(err, 'Failed to delete view') });
    }
  };

  const applyPreset = (id: string, config: AgentListViewConfig) => {
    setActiveViewId(id);
    onApplyConfig(config);
    setIsOpen(false);
  };

  const applySavedView = (view: SavedView) => {
    if (!view.view_config) return;
    try {
      const config = JSON.parse(view.view_config) as AgentListViewConfig;
      applyPreset(view.id, { ...DEFAULT_VIEW_CONFIG, ...config });
    } catch {
      // intentional: non-critical parse failure
    }
  };

  const handleReset = () => {
    setActiveViewId(null);
    onApplyConfig(DEFAULT_VIEW_CONFIG);
  };

  const isDefault = currentConfig.statusFilter === 'all'
    && currentConfig.healthFilter === 'all'
    && currentConfig.connectorFilter === 'all'
    && !currentConfig.favoriteOnly
    && currentConfig.sortKey === 'name'
    && currentConfig.sortDirection === 'asc';

  const activeLabel = activeViewId
    ? (SMART_PRESETS.find((p) => p.id === activeViewId)?.name
      ?? views.find((v) => v.id === activeViewId)?.name
      ?? t.agents.view_presets.custom_view)
    : null;

  return (
    <div className="flex items-center gap-2">
      {/* Active view indicator + reset */}
      {!isDefault && (
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-card bg-primary/8 border border-primary/15 text-md text-primary/80">
          {activeLabel && <span className="font-medium">{activeLabel}</span>}
          {!activeLabel && <span className="font-medium">{t.agents.view_presets.custom_filters}</span>}
          <button
            type="button"
            onClick={handleReset}
            className="ml-1 p-0.5 rounded hover:bg-primary/15 transition-colors"
            title={t.agents.view_presets.reset_defaults}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Saved views dropdown */}
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-card text-md font-medium border border-primary/15 bg-secondary/30 text-muted-foreground/70 hover:bg-secondary/50 hover:text-muted-foreground transition-all"
        >
          <Bookmark className="w-3.5 h-3.5" />
          {t.agents.view_presets.views}
          <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {isOpen && (
          <div className="absolute right-0 mt-1.5 w-60 bg-background border border-primary/20 rounded-modal shadow-elevation-3 shadow-black/20 z-50 overflow-hidden flex flex-col">
            {/* Save current */}
            {isSaving ? (
              <div className="p-2 flex items-center gap-1.5 border-b border-primary/10">
                <input
                  autoFocus
                  type="text"
                  placeholder={t.agents.view_presets.view_name_placeholder}
                  className="flex-1 bg-transparent border border-primary/20 rounded-card px-2 py-1 text-md focus-visible:outline-none focus-visible:border-primary/50 text-foreground"
                  value={newViewName}
                  onChange={(e) => setNewViewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSave();
                    if (e.key === 'Escape') setIsSaving(false);
                  }}
                />
                <Button variant="ghost" size="icon-sm" onClick={handleSave} disabled={!newViewName.trim()} disabledReason={t.agents.view_presets.enter_view_name} className="text-emerald-500 hover:bg-emerald-500/10">
                  <Check className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => setIsSaving(false)}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsSaving(true)}
                className="w-full flex items-center gap-2 px-3 py-2 text-md text-primary hover:bg-primary/10 transition-colors text-left border-b border-primary/10"
              >
                <Plus className="w-3.5 h-3.5" />
                {t.agents.view_presets.save_current}
              </button>
            )}

            <div className="max-h-64 overflow-y-auto py-1">
              {/* Smart presets */}
              <div className="px-3 py-1 text-md uppercase tracking-wider text-muted-foreground/50 font-semibold flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                {t.agents.view_presets.smart_presets}
              </div>
              {SMART_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset.id, preset.config)}
                  className={`w-full px-3 py-1.5 text-md text-left transition-colors flex items-center gap-2 ${
                    activeViewId === preset.id
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-foreground/80 hover:bg-secondary/50'
                  }`}
                >
                  {preset.name}
                  {activeViewId === preset.id && <Check className="w-3 h-3 ml-auto text-primary" />}
                </button>
              ))}

              {/* User saved views */}
              {views.length > 0 && (
                <>
                  <div className="px-3 py-1 mt-1.5 text-md uppercase tracking-wider text-muted-foreground/50 font-semibold border-t border-primary/10 pt-2">
                    {t.agents.view_presets.your_views}
                  </div>
                  {views.map((view) => (
                    <div
                      key={view.id}
                      className={`group flex items-center justify-between px-3 py-1.5 cursor-pointer transition-colors ${
                        activeViewId === view.id
                          ? 'bg-primary/10'
                          : 'hover:bg-secondary/50'
                      }`}
                      onClick={() => applySavedView(view)}
                    >
                      <span className={`text-md truncate flex-1 pr-2 ${
                        activeViewId === view.id ? 'text-primary font-medium' : 'text-foreground/80'
                      }`}>
                        {view.name}
                      </span>
                      <Button
                        variant="ghost" size="icon-sm"
                        onClick={(e) => handleDelete(view.id, e)}
                        className="opacity-0 group-hover:opacity-100 text-destructive/60 hover:text-destructive hover:bg-destructive/10 flex-shrink-0"
                        title={t.agents.view_presets.delete_view}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
