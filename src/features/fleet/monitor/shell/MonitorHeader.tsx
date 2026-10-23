// The Monitor header: the title, the ROUTER (four peer destinations, one click
// apart, no nesting), the live-mode pop-up toggle and the close button.

import { X, Activity, MessagesSquare, Bell, LayoutGrid, Orbit, DraftingCompass } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import type { MonitorView } from './monitorRouter';

export function MonitorHeader({ activeTab, onSelect, onClose }: {
  activeTab: MonitorView;
  onSelect: (view: MonitorView) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // Live-mode pop-ups on/off — surfaced in the header so it's always reachable.
  const liveMode = useSystemStore((s) => s.monitorLiveMode);
  const toggleLiveMode = useSystemStore((s) => s.toggleMonitorLiveMode);

  // Each destination keeps the icon its own surface header uses, so the tab
  // and the view it opens read as the same thing.
  const VIEWS: Array<{ id: MonitorView; label: string; hint: string; icon: typeof LayoutGrid }> = [
    { id: 'activity', label: t.monitor.activity_mode, hint: t.monitor.activity_mode_title, icon: LayoutGrid },
    { id: 'blueprint', label: t.decisionCenter.lens.tab_blueprint, hint: t.decisionCenter.lens.tab_blueprint_hint, icon: DraftingCompass },
    { id: 'conversations', label: t.monitor.channels_layout_grid, hint: t.monitor.channels_layout_grid_hint, icon: MessagesSquare },
    { id: 'map', label: t.monitor.channels_layout_map, hint: t.monitor.channels_layout_map_hint, icon: Orbit },
  ];

  // z-20 so any floating child menu clears the body
  return (
    <div className="relative z-20 flex-shrink-0 flex items-center justify-between gap-4 px-6 h-14 border-b border-primary/10 bg-secondary/15">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-modal bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Activity className="w-4 h-4 text-primary" />
        </div>
        <div className="min-w-0">
          <h2 className="typo-heading-lg text-foreground">{t.monitor.title}</h2>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1" role="group" data-testid="monitor-view-tabs">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = activeTab === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => onSelect(v.id)}
                aria-pressed={on}
                title={v.hint}
                data-testid={`monitor-view-${v.id}`}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border typo-body-lg transition-colors ${
                  on
                    ? 'border-primary/45 bg-primary/15 text-primary'
                    : 'border-primary/15 bg-secondary/20 text-foreground hover:bg-secondary/30'
                }`}
              >
                <Icon className="w-3 h-3" />
                {v.label}
              </button>
            );
          })}
        </div>
        {/* Live-mode pop-ups on/off — icon-only, always reachable here. */}
        <button
          type="button"
          onClick={toggleLiveMode}
          aria-pressed={liveMode}
          aria-label={t.monitor.live_toggle}
          title={t.monitor.live_toggle_hint}
          className={`ml-1 inline-flex items-center justify-center p-1.5 rounded-full border transition-colors ${
            liveMode
              ? 'border-status-success/40 bg-status-success/15 text-status-success'
              : 'border-primary/15 bg-secondary/20 text-foreground hover:bg-secondary/30'
          }`}
        >
          <Bell className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-modal border border-primary/15 text-foreground hover:text-foreground hover:bg-secondary/30 transition-colors"
          aria-label={t.monitor.close}
          title={t.monitor.close_hint}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
