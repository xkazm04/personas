import { Clock, Shield, ArrowLeftRight, X } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

interface ExecutionListHeaderProps {
  executionCount: number;
  showRaw: boolean;
  setShowRaw: (value: boolean) => void;
  compareMode: boolean;
  setCompareMode: (value: boolean) => void;
  exitCompareMode: () => void;
  compareLeft: string | null;
  compareRight: string | null;
  canCompare: boolean;
  setShowComparison: (value: boolean) => void;
}

export function ExecutionListHeader({
  executionCount,
  showRaw,
  setShowRaw,
  compareMode,
  setCompareMode,
  exitCompareMode,
  compareLeft,
  compareRight,
  canCompare,
  setShowComparison,
}: ExecutionListHeaderProps) {
  const { t } = useTranslation();

  return (
    <>
      <div className="flex items-center gap-2">
        <h4 className="flex items-center gap-2.5 typo-heading text-foreground/90 tracking-wide">
          <span className="w-6 h-[2px] bg-gradient-to-r from-primary/50 to-accent/50 rounded-full" />
          <Clock className="w-3.5 h-3.5" />
          {t.agents.executions.history}
        </h4>
        {executionCount > 0 && (
          <Tooltip content={showRaw ? t.agents.executions.sensitive_visible : t.agents.executions.sensitive_masked}>
            <button
              onClick={() => setShowRaw(!showRaw)}
              className={`ml-auto flex items-center gap-1 px-2 py-1 typo-body rounded-lg transition-colors ${
                showRaw
                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                  : 'text-muted-foreground/80 hover:text-muted-foreground/90 border border-transparent'
              }`}
            >
              <Shield className="w-3 h-3" />
              {showRaw ? t.agents.executions.raw : t.agents.executions.masked}
            </button>
          </Tooltip>
        )}
        {executionCount >= 2 && (
          <button
            onClick={() => compareMode ? exitCompareMode() : setCompareMode(true)}
            className={`flex items-center gap-1 px-2 py-1 typo-body rounded-lg transition-colors ${
              compareMode
                ? 'bg-primary/15 text-primary/80 border border-primary/20'
                : 'text-muted-foreground/80 hover:text-muted-foreground/90 border border-transparent'
            }`}
          >
            {compareMode ? <X className="w-3 h-3" /> : <ArrowLeftRight className="w-3 h-3" />}
            {compareMode ? t.common.cancel : t.agents.executions.compare}
          </button>
        )}
      </div>

      {/* Compare mode toolbar */}
      {compareMode && (
        <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-xl typo-body">
          <ArrowLeftRight className="w-3.5 h-3.5 text-primary/60 flex-shrink-0" />
          <span className="text-muted-foreground/70">
            {!compareLeft
              ? t.agents.executions.select_first
              : !compareRight
                ? t.agents.executions.select_second
                : t.agents.executions.ready_to_compare}
          </span>
          {compareLeft && (
            <span className="ml-auto flex items-center gap-1.5">
              <span className="typo-code text-indigo-400">#{compareLeft.slice(0, 8)}</span>
              {compareRight && (
                <>
                  <span className="text-muted-foreground/70">{t.agents.executions.vs}</span>
                  <span className="typo-code text-pink-400">#{compareRight.slice(0, 8)}</span>
                </>
              )}
            </span>
          )}
          {canCompare && (
            <button
              onClick={() => setShowComparison(true)}
              className="ml-2 px-2.5 py-1 typo-heading rounded-xl bg-primary/15 text-primary/80 border border-primary/20 hover:bg-primary/25 transition-colors"
            >
              {t.agents.executions.compare}
            </button>
          )}
        </div>
      )}
    </>
  );
}
