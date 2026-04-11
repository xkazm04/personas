import { ArrowLeftRight, X, Shield } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

interface ExecutionListFiltersProps {
  showRaw: boolean;
  setShowRaw: (v: boolean) => void;
  compareMode: boolean;
  exitCompareMode: () => void;
  setCompareMode: (v: boolean) => void;
  hasExecutions: boolean;
  hasEnoughToCompare: boolean;
  compareLeft: string | null;
  compareRight: string | null;
  canCompare: boolean;
  onShowComparison: () => void;
}

export function ExecutionListFilters({
  showRaw,
  setShowRaw,
  compareMode,
  exitCompareMode,
  setCompareMode,
  hasExecutions,
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
      {hasExecutions && (
        <Tooltip content={showRaw ? 'Sensitive values are visible' : 'Sensitive values are masked'}>
          <button
            onClick={() => setShowRaw(!showRaw)}
            className={`ml-auto flex items-center gap-1 px-2 py-1 typo-body rounded-lg transition-colors ${
              showRaw
                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                : 'text-muted-foreground/50 hover:text-muted-foreground/70 border border-transparent'
            }`}
          >
            <Shield className="w-3 h-3" />
            {showRaw ? e.raw : e.masked}
          </button>
        </Tooltip>
      )}
      {hasEnoughToCompare && (
        <button
          onClick={() => compareMode ? exitCompareMode() : setCompareMode(true)}
          className={`flex items-center gap-1 px-2 py-1 typo-body rounded-lg transition-colors ${
            compareMode
              ? 'bg-primary/15 text-primary/80 border border-primary/20'
              : 'text-muted-foreground/50 hover:text-muted-foreground/70 border border-transparent'
          }`}
        >
          {compareMode ? <X className="w-3 h-3" /> : <ArrowLeftRight className="w-3 h-3" />}
          {compareMode ? e.cancel : e.compare}
        </button>
      )}

      {/* Compare mode toolbar */}
      {compareMode && (
        <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-xl typo-body col-span-full">
          <ArrowLeftRight className="w-3.5 h-3.5 text-primary/60 flex-shrink-0" />
          <span className="text-muted-foreground/70">
            {!compareLeft
              ? e.select_first
              : !compareRight
                ? e.select_second
                : e.ready_to_compare}
          </span>
          {compareLeft && (
            <span className="ml-auto flex items-center gap-1.5">
              <span className="typo-code text-indigo-400">#{compareLeft.slice(0, 8)}</span>
              {compareRight && (
                <>
                  <span className="text-muted-foreground/40">{e.vs}</span>
                  <span className="typo-code text-pink-400">#{compareRight.slice(0, 8)}</span>
                </>
              )}
            </span>
          )}
          {canCompare && (
            <button
              onClick={onShowComparison}
              className="ml-2 px-2.5 py-1 typo-heading rounded-xl bg-primary/15 text-primary/80 border border-primary/20 hover:bg-primary/25 transition-colors"
            >
              Compare
            </button>
          )}
        </div>
      )}
    </>
  );
}
