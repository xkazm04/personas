/**
 * Toolbar — all filter / sort / action controls for the Dispatch view.
 *
 * Parity with the old Table baseline (class pills, source persona dropdown,
 * show-unconnected) plus Dispatch-specific "active within 1h" toggle and a
 * sort-mode selector. The "N live" counter that used to live in the right
 * edge of this toolbar was removed in round 3 — pulse dots at row level now
 * carry the live signal on their own.
 */
import { ArrowUpDown, RefreshCw, Search, Wand2 } from 'lucide-react';
import { ColumnDropdownFilter } from '@/features/shared/components/forms/ColumnDropdownFilter';
import { SORT_MODES, type SortMode } from './types';
import type { SourceOption } from './useRoutingFilters';

type ClassKey = 'persona' | 'common' | 'external';

const CLASS_PILLS: ReadonlyArray<{ key: ClassKey; label: string; className: string }> = [
  { key: 'persona',  label: 'USR', className: 'text-violet-400 bg-violet-500/10 border-violet-500/30' },
  { key: 'common',   label: 'SYS', className: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30' },
  { key: 'external', label: 'EXT', className: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
];

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

export function Toolbar(props: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-primary/10 bg-card/30">
      {/* Search */}
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/60" />
        <input
          type="text"
          value={props.search}
          onChange={e => props.onSearchChange(e.target.value)}
          placeholder="Filter events…"
          className="w-full pl-8 pr-3 py-1.5 text-sm bg-secondary/30 border border-primary/10 rounded-card text-foreground placeholder:text-foreground/50 focus:outline-none focus:border-cyan-400/40"
        />
      </div>

      {/* Class pills */}
      <div className="flex items-center gap-1">
        {CLASS_PILLS.map(({ key, label, className }) => {
          const active = props.visibleClasses.has(key);
          return (
            <button
              key={key}
              onClick={() => props.onToggleClass(key)}
              title={`${active ? 'Hide' : 'Show'} ${label} events (${props.classCounts[key]})`}
              className={`px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider border transition-colors ${
                active ? className : 'text-foreground border-border/40 hover:border-border opacity-50 hover:opacity-80'
              }`}
            >
              {label}
              <span className="ml-1 opacity-60 tabular-nums">{props.classCounts[key]}</span>
            </button>
          );
        })}
      </div>

      {/* Source persona dropdown */}
      <div className="w-[200px]">
        <ColumnDropdownFilter
          label="Source Personas"
          value={props.sourceFilter}
          options={props.sourceOptions}
          onChange={(v) => props.onSourceFilterChange(v || 'all')}
        />
      </div>

      <label className="flex items-center gap-1.5 text-xs text-foreground/70 cursor-pointer select-none">
        <input type="checkbox" checked={props.showUnconnected} onChange={e => props.onShowUnconnectedChange(e.target.checked)} className="accent-primary" />
        Show unconnected ({props.unconnectedCount})
      </label>

      <label className="flex items-center gap-1.5 text-xs text-foreground/70 cursor-pointer select-none">
        <input type="checkbox" checked={props.activeOnly} onChange={e => props.onActiveOnlyChange(e.target.checked)} className="accent-emerald-400" />
        Active within 1h only
      </label>

      {/* Sort */}
      <div className="flex items-center gap-1 pl-2 border-l border-primary/10">
        <ArrowUpDown className="w-3.5 h-3.5 text-foreground/50" />
        <select
          value={props.sortMode}
          onChange={(e) => props.onSortModeChange(e.target.value as SortMode)}
          className="bg-secondary/30 border border-primary/10 rounded-card text-xs text-foreground px-2 py-1 focus:outline-none focus:border-cyan-400/40"
          title="Sort events within each panel"
        >
          {SORT_MODES.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
      </div>

      {/* Stats + actions */}
      <div className="ml-auto flex items-center gap-3">
        <span className="text-xs text-foreground/60 tabular-nums">
          {props.visibleCount} event{props.visibleCount !== 1 ? 's' : ''} · {props.totalConnections} connection{props.totalConnections !== 1 ? 's' : ''}
        </span>
        <button
          onClick={props.onBackfill}
          disabled={props.isBackfilling}
          className="p-1.5 rounded-card hover:bg-secondary/60 text-foreground/60 hover:text-foreground transition-colors disabled:opacity-40"
          title="Backfill event handlers"
        >
          <Wand2 className={`w-4 h-4 ${props.isBackfilling ? 'animate-pulse' : ''}`} />
        </button>
        <button
          onClick={props.onReload}
          className="p-1.5 rounded-card hover:bg-secondary/60 text-foreground/60 hover:text-foreground transition-colors"
          title="Reload"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
