import { Clock, Star } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { DensityToggle } from '@/features/shared/components/display/DensityToggle';
import type { Density } from '@/lib/density';
import type { ExecutionAnnotation } from '@/lib/bindings/ExecutionAnnotation';
import type { ExecutionListItem } from '@/lib/bindings/ExecutionListItem';
import { ExecutionListFilters } from './ExecutionListFilters';
import { BulkRerunToolbar } from './BulkRerunToolbar';
import type { useExecutionCompare } from './useExecutionCompare';
import type { useExecutionBulk } from './useExecutionBulk';

interface ExecutionListToolbarProps {
  rows: ExecutionListItem[];
  annotations: ExecutionAnnotation[];
  showSimulations: boolean;
  setShowSimulations: (v: boolean) => void;
  hasSimulations: boolean;
  compare: ReturnType<typeof useExecutionCompare>;
  bulk: ReturnType<typeof useExecutionBulk>;
  density: Density;
  setDensity: (d: Density) => void;
}

/** Permanent chrome above the run ledger: title, view toggles, compare + bulk entry points, density. */
export function ExecutionListToolbar({
  rows, annotations, showSimulations, setShowSimulations, hasSimulations, compare, bulk, density, setDensity,
}: ExecutionListToolbarProps) {
  const { t } = useTranslation();
  const e = t.agents.executions;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <h4 className="flex items-center gap-2.5 typo-heading text-foreground/90">
        <span className="w-6 h-[2px] bg-gradient-to-r from-primary/50 to-accent/50 rounded-full" />
        <Clock className="w-3.5 h-3.5" />
        {e.history}
      </h4>
      <ExecutionListFilters
        showSimulations={showSimulations}
        setShowSimulations={setShowSimulations}
        hasSimulations={hasSimulations}
        compareMode={compare.compareMode}
        exitCompareMode={compare.exit}
        setCompareMode={(on) => { if (on) bulk.exit(); compare.setCompareMode(on); }}
        hasEnoughToCompare={rows.length >= 2}
        compareLeft={compare.compareLeft}
        compareRight={compare.compareRight}
        canCompare={compare.canCompare}
        onShowComparison={() => { if (compare.compareLeft && compare.compareRight) void compare.openPair(compare.compareLeft, compare.compareRight); }}
      />
      <BulkRerunToolbar
        bulkMode={bulk.bulkMode}
        onEnter={() => { compare.exit(); bulk.enter(); }}
        onExit={bulk.exit}
        selectedCount={bulk.selectedRows.length}
        rows={rows}
        annotations={annotations}
        onSelectAllFailed={() => bulk.selectFailed()}
        onSelectSinceTimestamp={bulk.selectFailed}
        onClear={bulk.clear}
        onStart={bulk.start}
        isRunning={bulk.running}
        hasExecutions={rows.length > 0}
        hasEnoughToBulk={rows.length >= 2}
      />
      {compare.starredPair && (
        <Tooltip content={e.compare_starred_pair_tooltip}>
          <button
            type="button"
            onClick={() => { const [l, r] = compare.starredPair!; void compare.openPair(l, r); }}
            className="flex items-center gap-1 px-2 py-1 typo-body rounded-card transition-colors text-status-warning hover:bg-status-warning/10 border border-status-warning/20"
          >
            <Star className="w-3 h-3" fill="currentColor" />
            {e.compare_starred_pair}
          </button>
        </Tooltip>
      )}
      <div className="ml-auto">
        <DensityToggle density={density} onChange={setDensity} scopeId="execution-list" />
      </div>
    </div>
  );
}
