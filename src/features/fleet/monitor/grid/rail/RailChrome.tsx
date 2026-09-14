// RailChrome — the rail's edge and its two header rows.
//
// Split out of `ActivityRail` so that file is the composition and the feed
// wiring only. Nothing here holds state; all three take what they render.

import type { LucideIcon } from 'lucide-react';
import { X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { RailProjectFilter } from './railFilter';
import type { useRailWidth } from './useRailWidth';

export type RailTab = 'reviews' | 'dispatch' | 'messages';

/**
 * THE RESIZE HANDLE, standing in for the rail's left border rather than
 * sitting beside it — so the affordance is exactly where the edge the operator
 * wants to move already is. `handleProps` carries the splitter ARIA
 * (`separator`, orientation, valuenow/min/max), the tab stop and the arrow keys
 * along with the pointer wiring: a resize reachable only by pointer is not a
 * smaller feature, it is an inoperable one for anyone who needs the wider rail
 * most.
 */
export function RailResizeHandle({ rail }: { rail: ReturnType<typeof useRailWidth> }) {
  const { t } = useTranslation();
  return (
    <div
      {...rail.handleProps}
      aria-label={t.monitor.grid_rail_resize}
      data-testid="activity-rail-resize"
      className={`group relative w-1 flex-shrink-0 cursor-col-resize border-l border-border transition-colors focus-ring ${
        rail.dragging ? 'bg-primary/40' : 'hover:bg-primary/25'
      }`}
    >
      {/* A 1px target is not a target. The hit area is widened either side
          without widening the paint. */}
      <span aria-hidden className="absolute inset-y-0 -left-1.5 -right-1.5" />
      <span
        aria-hidden
        className={`absolute left-1/2 top-1/2 h-8 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors ${
          rail.dragging ? 'bg-primary' : 'bg-border group-hover:bg-primary/50'
        }`}
      />
    </div>
  );
}

export interface RailTabSpec {
  id: RailTab;
  label: string;
  icon: LucideIcon;
  count: number;
}

/** Conversations' own tab styling, verbatim — the two surfaces are one room. */
export function RailTabBar({
  tabs, tab, onSelect,
}: { tabs: RailTabSpec[]; tab: RailTab; onSelect: (id: RailTab) => void }) {
  const { t } = useTranslation();
  const tabClass = (on: boolean) =>
    `px-2 py-0.5 rounded-interactive typo-label transition-colors ${
      on ? 'text-foreground bg-secondary/40' : 'text-foreground opacity-45 hover:opacity-80'
    }`;

  return (
    <div
      className="flex h-9 flex-shrink-0 items-center gap-1 border-b border-border px-2"
      role="group"
      aria-label={t.monitor.grid_rail_tabs_aria}
    >
      {tabs.map((v) => {
        const Icon = v.icon;
        return (
          <button
            key={v.id}
            type="button"
            onClick={() => onSelect(v.id)}
            aria-pressed={tab === v.id}
            data-testid={`activity-rail-tab-${v.id}`}
            className={tabClass(tab === v.id)}
          >
            <Icon className="mr-1 inline h-3 w-3" />
            {v.label}
            {v.count > 0 && <span className="ml-1 tabular-nums opacity-60">{v.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * THE SCOPE CHIP. Present only while a scope is, and it is the only control
 * that clears one — a filter applied from a surface OTHER than this one (the
 * board's column header) must be visible and revocable from here, or the rail
 * reads as mysteriously empty.
 */
export function RailScopeChip({
  filter, onClear,
}: { filter: RailProjectFilter; onClear?: () => void }) {
  const { t, tx } = useTranslation();
  return (
    <div className="flex h-7 flex-shrink-0 items-center gap-1.5 border-b border-border bg-primary/[0.06] px-2">
      <span className="min-w-0 flex-1 truncate typo-caption text-foreground">
        {tx(t.monitor.grid_rail_scoped_to, { project: filter.label })}
      </span>
      {onClear && (
        <Tooltip content={t.monitor.grid_rail_scope_clear}>
          <button
            type="button"
            onClick={onClear}
            aria-label={t.monitor.grid_rail_scope_clear}
            data-testid="activity-rail-scope-clear"
            className="focus-ring flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-foreground opacity-60 transition-opacity hover:opacity-100"
          >
            <X className="h-3 w-3" />
          </button>
        </Tooltip>
      )}
    </div>
  );
}
