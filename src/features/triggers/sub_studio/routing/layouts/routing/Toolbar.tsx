/**
 * Toolbar — filter / sort / action controls for the Dispatch view.
 *
 * The USR/SYS/EXT class pills live in the page header (published via
 * setHeaderExtra at TriggersPage level); the per-column Source / Event /
 * Listeners filters live in <RoutingTableHeader />. The toolbar carries the
 * remaining cross-cutting controls: two boolean toggles, sort, stats, reload.
 */
import { RefreshCw } from 'lucide-react';
import { ColumnDropdownFilter } from '@/features/shared/components/forms/ColumnDropdownFilter';
import { SORT_MODES, type SortMode } from './types';
import { DebtText } from '@/i18n/DebtText';


interface Props {
  activeOnly: boolean; onActiveOnlyChange: (v: boolean) => void;
  showUnconnected: boolean; onShowUnconnectedChange: (v: boolean) => void;
  unconnectedCount: number;
  sortMode: SortMode; onSortModeChange: (m: SortMode) => void;
  visibleCount: number;
  totalConnections: number;
  onReload: () => void;
}

const SORT_OPTIONS = SORT_MODES.map(m => ({ value: m.key, label: m.label }));

export function Toolbar(props: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-primary/10 bg-card-bg/40">
      <label className="flex items-center gap-1.5 typo-body text-foreground cursor-pointer select-none">
        <input type="checkbox" checked={props.showUnconnected} onChange={e => props.onShowUnconnectedChange(e.target.checked)} className="accent-primary" />
        <DebtText k="auto_show_unconnected_591153d9" />{props.unconnectedCount})
      </label>

      <label className="flex items-center gap-1.5 typo-body text-foreground cursor-pointer select-none">
        <input type="checkbox" checked={props.activeOnly} onChange={e => props.onActiveOnlyChange(e.target.checked)} className="accent-emerald-400" />
        <DebtText k="auto_active_within_1h_only_82477852" />
      </label>

      {/* Sort — themed dropdown. */}
      <div className="pl-2 border-l border-primary/10">
        <ColumnDropdownFilter
          label="Sort: Recent activity"
          value={props.sortMode}
          options={SORT_OPTIONS}
          onChange={(v) => props.onSortModeChange(((v || 'activity') as SortMode))}
          allValue="activity"
        />
      </div>

      {/* Stats + actions */}
      <div className="ml-auto flex items-center gap-3">
        <span className="typo-body text-foreground tabular-nums">
          {props.visibleCount} event{props.visibleCount !== 1 ? 's' : ''} · {props.totalConnections} connection{props.totalConnections !== 1 ? 's' : ''}
        </span>
        <button
          onClick={props.onReload}
          className="p-1.5 rounded-card hover:bg-secondary/60 text-foreground hover:text-foreground transition-colors"
          title="Reload"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
