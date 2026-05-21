/**
 * Toolbar — filter / sort / action controls for the Dispatch view.
 *
 * USR/SYS/EXT class pills now live in the page header (published via the
 * setHeaderExtra callback at TriggersPage level), so they're not rendered
 * here. The toolbar carries: search, source-persona filter, two boolean
 * toggles, sort dropdown, stats, and action buttons.
 */
import { RefreshCw, Search, Wand2 } from 'lucide-react';
import { ColumnDropdownFilter } from '@/features/shared/components/forms/ColumnDropdownFilter';
import { SORT_MODES, type SortMode } from './types';
import type { SourceOption } from './useRoutingFilters';
import { DebtText, debtText } from '@/i18n/DebtText';


type ClassKey = 'persona' | 'common' | 'external';

interface Props {
  // Filter state
  search: string; onSearchChange: (v: string) => void;
  sourceFilter: string; onSourceFilterChange: (v: string) => void;
  sourceOptions: SourceOption[];
  activeOnly: boolean; onActiveOnlyChange: (v: boolean) => void;
  showUnconnected: boolean; onShowUnconnectedChange: (v: boolean) => void;
  visibleClasses: Set<ClassKey>; onToggleClass: (c: ClassKey) => void;
  classCounts: Record<ClassKey, number>;
  unconnectedCount: number;
  sortMode: SortMode; onSortModeChange: (m: SortMode) => void;
  // Stats + actions
  visibleCount: number;
  totalConnections: number;
  isBackfilling: boolean;
  onBackfill: () => void;
  onReload: () => void;
}

const SORT_OPTIONS = SORT_MODES.map(m => ({ value: m.key, label: m.label }));

export function Toolbar(props: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-primary/10 bg-card-bg/40">
      {/* Search */}
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground" />
        <input
          type="text"
          value={props.search}
          onChange={e => props.onSearchChange(e.target.value)}
          placeholder={debtText("auto_filter_events_ce0f34d9")}
          className="w-full pl-8 pr-3 py-1.5 typo-body bg-secondary/30 border border-primary/10 rounded-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40"
        />
      </div>

      {/* Source persona dropdown */}
      <div className="w-[200px]">
        <ColumnDropdownFilter
          label="Source Personas"
          value={props.sourceFilter}
          options={props.sourceOptions}
          onChange={(v) => props.onSourceFilterChange(v || 'all')}
          popupClassName="min-w-[400px]"
        />
      </div>

      <label className="flex items-center gap-1.5 typo-caption text-foreground cursor-pointer select-none">
        <input type="checkbox" checked={props.showUnconnected} onChange={e => props.onShowUnconnectedChange(e.target.checked)} className="accent-primary" />
        <DebtText k="auto_show_unconnected_591153d9" />{props.unconnectedCount})
      </label>

      <label className="flex items-center gap-1.5 typo-caption text-foreground cursor-pointer select-none">
        <input type="checkbox" checked={props.activeOnly} onChange={e => props.onActiveOnlyChange(e.target.checked)} className="accent-emerald-400" />
        <DebtText k="auto_active_within_1h_only_82477852" />
      </label>

      {/* Sort — themed dropdown matching the Source Personas filter style. */}
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
        <span className="typo-caption text-foreground tabular-nums">
          {props.visibleCount} event{props.visibleCount !== 1 ? 's' : ''} · {props.totalConnections} connection{props.totalConnections !== 1 ? 's' : ''}
        </span>
        <button
          onClick={props.onBackfill}
          disabled={props.isBackfilling}
          className="p-1.5 rounded-card hover:bg-secondary/60 text-foreground hover:text-foreground transition-colors disabled:opacity-40"
          title={debtText("auto_backfill_event_handlers_c8c56de6")}
        >
          <Wand2 className={`w-4 h-4 ${props.isBackfilling ? 'animate-pulse' : ''}`} />
        </button>
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
