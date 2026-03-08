import { RotateCcw, Loader2 } from 'lucide-react';
import type { VersionComparison } from '../libs/usePromptPerformanceSummary';
import { fmtPct } from '../libs/performanceHelpers';

interface VersionComparisonCardProps {
  comparison: VersionComparison;
  rollingBack: boolean;
  onRollback: () => void;
}

export function VersionComparisonCard({ comparison, rollingBack, onRollback }: VersionComparisonCardProps) {
  return (
    <div
      className={`rounded-lg border p-3 space-y-2 ${
        comparison.isWorse
          ? 'border-red-500/20 bg-red-500/5'
          : 'border-primary/8 bg-secondary/30'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground/70">
          v{comparison.current.version_number} vs v{comparison.previous.version_number}
        </span>
        {comparison.isWorse && (
          <span className="text-[11px] font-medium text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded-full">
            Regression
          </span>
        )}
      </div>
      <div className="flex items-center gap-4 text-sm">
        <div>
          <span className="text-muted-foreground/50">Current: </span>
          <span className={`font-mono font-medium ${comparison.currentErrorRate > 0.1 ? 'text-red-400' : 'text-foreground/80'}`}>
            {fmtPct(comparison.currentErrorRate)}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground/50">Previous: </span>
          <span className="font-mono font-medium text-foreground/80">
            {fmtPct(comparison.previousErrorRate)}
          </span>
        </div>
      </div>

      {/* Rollback button */}
      {comparison.isWorse && (
        <button
          onClick={onRollback}
          disabled={rollingBack}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-colors disabled:opacity-50"
        >
          {rollingBack ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RotateCcw className="w-3.5 h-3.5" />
          )}
          Rollback to v{comparison.previous.version_number}
        </button>
      )}
    </div>
  );
}
