// Variant B — "Cross-tab" picker.
//
// The Context Ledger's cross-tabulation spine repurposed for dispatch: rows
// are contexts in their group bands, COLUMNS are the 22 scan lenses (icon
// headers). A filled cell means "this lens matches this context" — read
// ACROSS a row to see the sweep package a dispatch would run, DOWN a column
// to see a lens's whole footprint. The left gutter carries the skill's real
// coverage (fresh nodes · last swept) so a row is a dispatch record, not just
// a label. Row click toggles selection.
import { useMemo } from 'react';

import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import { SCAN_AGENTS } from '../../constants/scanAgents';
import { colorDot } from '../../sub_context/GroupColorPicker';
import type { PickerGroup, PickerRow } from './useContextPickerData';

export function ContextPickerCrossTab({ groups, selected, onToggle }: {
  groups: PickerGroup[];
  selected: Set<string>;
  onToggle: (name: string) => void;
}) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  const gridTemplate = `minmax(260px, 1.4fr) repeat(${SCAN_AGENTS.length}, 26px)`;

  return (
    <div className="rounded-card border border-primary/10 overflow-auto min-h-0 flex-1">
      {/* lens column headers — sticky, icon per lens */}
      <div
        className="grid items-end gap-0 px-3 py-2 bg-secondary/20 border-b border-primary/10 sticky top-0 z-10 backdrop-blur"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        <span className="typo-label text-foreground/60">{d.context_column_label}</span>
        {SCAN_AGENTS.map((a) => (
          <Tooltip key={a.key} content={a.label}>
            <span className="flex items-start justify-center pt-0.5">
              <a.icon className="w-3.5 h-3.5" style={{ color: a.color }} aria-hidden strokeWidth={1.75} />
            </span>
          </Tooltip>
        ))}
      </div>

      {groups.map((g) => {
        const dot = colorDot(g.color);
        return (
          <div key={g.id}>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary/10 border-b border-primary/5">
              <span className={`w-2.5 h-2.5 rounded-full ${dot.bg}`} />
              <span className="typo-title">{g.name}</span>
              <span className="typo-caption text-foreground/50 tabular-nums">{g.rows.length}</span>
            </div>
            <div className="divide-y divide-primary/5">
              {g.rows.map((r) => (
                <CrossTabRow key={r.id} row={r} gridTemplate={gridTemplate} isSelected={selected.has(r.name)} onToggle={onToggle} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CrossTabRow({ row, gridTemplate, isSelected, onToggle }: {
  row: PickerRow;
  gridTemplate: string;
  isSelected: boolean;
  onToggle: (name: string) => void;
}) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  const matched = useMemo(() => new Set(row.lensKeys), [row.lensKeys]);
  const covered = row.freshNodes > 0;

  return (
    <div
      role="row"
      className={`grid items-center gap-0 px-3 py-1 transition-colors cursor-pointer ${
        isSelected ? 'bg-primary/10' : 'hover:bg-secondary/10'
      }`}
      style={{ gridTemplateColumns: gridTemplate }}
      onClick={() => onToggle(row.name)}
      data-testid={`ctx-picker-row-${row.name}`}
    >
      <div className="flex items-center gap-2.5 min-w-0 pr-3">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggle(row.name)}
          onClick={(e) => e.stopPropagation()}
          className="accent-[var(--color-primary)] shrink-0"
          aria-label={row.name}
        />
        <span className="typo-body font-medium text-foreground truncate">{row.name}</span>
        <span className="ml-auto shrink-0 inline-flex items-center gap-2">
          <Tooltip content={`${row.freshNodes} ${d.ctx_picker_fresh_nodes}`}>
            <span className={`typo-caption tabular-nums ${covered ? 'text-status-success' : 'text-foreground/25'}`}>
              {row.freshNodes}
            </span>
          </Tooltip>
          <span className="typo-caption text-foreground/45 w-16 text-right">
            {row.latestAt ? <RelativeTime timestamp={row.latestAt} /> : d.ctx_picker_never}
          </span>
        </span>
      </div>

      {SCAN_AGENTS.map((a) => (
        <span key={a.key} className="flex items-center justify-center h-full">
          {matched.has(a.key) ? (
            <span className="w-2 h-2 rounded-full opacity-80" style={{ backgroundColor: a.color }} />
          ) : (
            <span className="w-1 h-1 rounded-full bg-foreground/10" />
          )}
        </span>
      ))}
    </div>
  );
}
