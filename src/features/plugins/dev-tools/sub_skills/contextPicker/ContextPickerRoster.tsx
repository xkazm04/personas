// Variant A — "Roster+" picker.
//
// The Context Map Roster+ spine (one row per group, contexts as two-storey
// tiles inside it) repurposed as a SELECTION surface: the tile's bottom storey
// swaps KPI/goal indicators for the stats that matter when dispatching a scan
// skill — matched lens count, fresh coverage nodes, last-swept age. Whole tile
// toggles selection; covered tiles read visually "warm" so the least-covered
// contexts pop out as the natural picks.
import { Layers, Sparkles } from 'lucide-react';

import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import { colorDot } from '../../sub_context/GroupColorPicker';
import type { PickerGroup, PickerRow } from './useContextPickerData';

export function ContextPickerRoster({ groups, selected, onToggle }: {
  groups: PickerGroup[];
  selected: Set<string>;
  onToggle: (name: string) => void;
}) {
  return (
    <div className="rounded-card border border-primary/10 overflow-auto min-h-0 flex-1 divide-y divide-primary/[0.07]">
      {groups.map((g) => {
        const dot = colorDot(g.color);
        return (
          <div key={g.id} className="flex items-start gap-3 px-3 py-2.5 hover:bg-secondary/[0.06] transition-colors">
            <div className="flex items-center gap-1.5 shrink-0 w-44 pt-1.5">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dot.bg}`} />
              <span className="typo-title truncate">{g.name}</span>
              <span className="typo-caption text-foreground/50 tabular-nums shrink-0">{g.rows.length}</span>
            </div>
            <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
              {g.rows.map((r) => (
                <RosterTile key={r.id} row={r} isSelected={selected.has(r.name)} onToggle={onToggle} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RosterTile({ row, isSelected, onToggle }: {
  row: PickerRow;
  isSelected: boolean;
  onToggle: (name: string) => void;
}) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  const covered = row.freshNodes > 0;
  return (
    <button
      type="button"
      onClick={() => onToggle(row.name)}
      aria-pressed={isSelected}
      className={`w-[12.5rem] rounded-card border text-left transition-colors ${
        covered ? 'bg-primary/[0.06] border-primary/20' : 'bg-secondary/[0.08] border-primary/10'
      } ${isSelected ? 'ring-1 ring-primary/70 border-primary/50' : 'hover:border-primary/30'}`}
      data-testid={`ctx-picker-tile-${row.name}`}
    >
      <span className="w-full flex items-center gap-1.5 px-2 py-1.5 min-w-0">
        <Tooltip content={covered ? d.ctx_picker_covered : d.ctx_picker_uncovered}>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${covered ? 'bg-status-success' : 'bg-foreground/20'}`} />
        </Tooltip>
        <span className="typo-body font-medium text-foreground truncate">{row.name}</span>
      </span>
      <span className="border-t border-foreground/10 flex items-center gap-2.5 px-2 py-1">
        <Tooltip content={`${row.lensKeys.length} ${d.ctx_picker_lenses}`}>
          <span className="inline-flex items-center gap-0.5 typo-caption tabular-nums text-foreground/70">
            <Layers className="w-3 h-3" />
            {row.lensKeys.length}
          </span>
        </Tooltip>
        <Tooltip content={`${row.freshNodes} ${d.ctx_picker_fresh_nodes}`}>
          <span className={`inline-flex items-center gap-0.5 typo-caption tabular-nums ${covered ? 'text-status-success' : 'text-foreground/25'}`}>
            <Sparkles className="w-3 h-3" />
            {row.freshNodes}
          </span>
        </Tooltip>
        <span className="ml-auto typo-caption text-foreground/45">
          {row.latestAt ? <RelativeTime timestamp={row.latestAt} /> : d.ctx_picker_never}
        </span>
      </span>
    </button>
  );
}
