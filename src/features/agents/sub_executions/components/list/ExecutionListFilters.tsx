import { ArrowLeftRight, X, FlaskConical } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

interface ExecutionListFiltersProps {
  showSimulations: boolean;
  setShowSimulations: (v: boolean) => void;
  hasSimulations: boolean;
  compareMode: boolean;
  exitCompareMode: () => void;
  setCompareMode: (v: boolean) => void;
  hasEnoughToCompare: boolean;
  compareLeft: string | null;
  compareRight: string | null;
  canCompare: boolean;
  onShowComparison: () => void;
}

export function ExecutionListFilters({
  showSimulations,
  setShowSimulations,
  hasSimulations,
  compareMode,
  exitCompareMode,
  setCompareMode,
  hasEnoughToCompare,
  compareLeft,
  compareRight,
  canCompare,
  onShowComparison,
}: ExecutionListFiltersProps) {
  const { t } = useTranslation();
  const e = t.agents.executions;
  return (
    <>
      {hasSimulations && (
        <Tooltip content={e.simulations_filter_tooltip}>
          <button
            type="button"
            onClick={() => setShowSimulations(!showSimulations)}
            className={`ml-auto flex items-center gap-1 px-2 py-1 typo-body rounded-card transition-colors ${
              showSimulations
                ? 'bg-brand-purple/10 text-brand-purple border border-brand-purple/20'
                : 'text-foreground hover:text-muted-foreground/70 border border-transparent'
            }`}
          >
            <FlaskConical className="w-3 h-3" />
            {showSimulations ? e.hide_simulations : e.show_simulations}
          </button>
        </Tooltip>
      )}
      {hasEnoughToCompare && (
        <button
          type="button"
          onClick={() => compareMode ? exitCompareMode() : setCompareMode(true)}
          className={`flex items-center gap-1 px-2 py-1 typo-body rounded-card transition-colors ${
            compareMode
              ? 'bg-primary/15 text-primary/80 border border-primary/20'
              : 'text-foreground hover:text-muted-foreground/70 border border-transparent'
          }`}
        >
          {compareMode ? <X className="w-3 h-3" /> : <ArrowLeftRight className="w-3 h-3" />}
          {compareMode ? e.cancel : e.compare}
        </button>
      )}

      {/* Compare mode toolbar */}
      {compareMode && (
        <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-modal typo-body col-span-full">
          <ArrowLeftRight className="w-3.5 h-3.5 text-primary/60 flex-shrink-0" />
          <span className="text-foreground">
            {!compareLeft
              ? e.select_first
              : !compareRight
                ? e.select_second
                : e.ready_to_compare}
          </span>
          {compareLeft && (
            <span className="ml-auto flex items-center gap-1.5">
              <span className="typo-code text-status-info">#{compareLeft.slice(0, 8)}</span>
              {compareRight && (
                <>
                  <span className="text-foreground">{e.vs}</span>
                  <span className="typo-code text-status-error">#{compareRight.slice(0, 8)}</span>
                </>
              )}
            </span>
          )}
          {canCompare && (
            <button
              type="button"
              onClick={onShowComparison}
              className="ml-2 px-2.5 py-1 typo-heading rounded-modal bg-primary/15 text-primary/80 border border-primary/20 hover:bg-primary/25 transition-colors"
            >
              {e.compare}
            </button>
          )}
        </div>
      )}
    </>
  );
}
