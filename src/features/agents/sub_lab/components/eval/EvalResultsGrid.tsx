import { useMemo, useEffect, useState } from 'react';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { Trophy } from 'lucide-react';
import { scoreColor } from '@/lib/eval/evalFramework';
import { buildEvalGridData } from '../../libs/evalAggregation';
import { EvalVersionCards } from './EvalVersionCards';
import { EvalRadarChart } from './EvalRadarChart';
import type { LabEvalResult } from '@/lib/bindings/LabEvalResult';

interface Props {
  results: LabEvalResult[];
}

export function EvalResultsGrid({ results }: Props) {
  const [celebrateWinnerId, setCelebrateWinnerId] = useState<string | null>(null);
  const { shouldAnimate } = useMotion();

  const { versionAggs, versions, models, grid, winnerId } = useMemo(
    () => buildEvalGridData(results),
    [results],
  );

  useEffect(() => {
    if (!shouldAnimate) { setCelebrateWinnerId(null); return; }
    if (!winnerId) return;
    setCelebrateWinnerId(winnerId);
    const timer = window.setTimeout(() => {
      setCelebrateWinnerId((prev) => (prev === winnerId ? null : prev));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [winnerId, shouldAnimate]);

  if (results.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground/80 text-sm" data-testid="eval-results-empty">
        No results to display
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="eval-results-grid">
      <EvalVersionCards versionAggs={versionAggs} winnerId={winnerId} celebrateWinnerId={celebrateWinnerId} />
      <EvalRadarChart versionAggs={versionAggs} />

      {/* Version x Model matrix grid */}
      <div className="space-y-2">
        <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
          <span className="w-6 h-[2px] bg-gradient-to-r from-primary/50 to-accent/50 rounded-full" />
          Version x Model Matrix
        </h4>
        <div className="overflow-x-auto border border-primary/10 rounded-xl">
          <table className="w-full text-sm" data-testid="eval-matrix-table">
            <thead>
              <tr className="border-b border-primary/10 bg-secondary/30">
                <th className="text-left px-3 py-2.5 font-medium text-muted-foreground/80">Version</th>
                {models.map((m) => (
                  <th key={m} className="text-center px-3 py-2.5 font-medium text-muted-foreground/80">{m}</th>
                ))}
                <th className="text-center px-3 py-2.5 font-medium text-muted-foreground/80">Avg</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((vId) => {
                const agg = versionAggs.find((a) => a.versionId === vId);
                const isWinner = vId === winnerId;
                return (
                  <tr key={vId} className={`border-b border-primary/5 transition-colors ${isWinner ? 'bg-primary/5' : 'hover:bg-secondary/10'}`}>
                    <td className="px-3 py-2.5 font-medium">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-foreground/80">v{agg?.versionNumber}</span>
                        {isWinner && <Trophy className="w-3 h-3 text-primary" />}
                      </div>
                    </td>
                    {models.map((mId) => {
                      const cell = grid[vId]?.[mId];
                      if (!cell || cell.count === 0) {
                        return <td key={mId} className="px-3 py-2.5 text-center text-muted-foreground/80">&mdash;</td>;
                      }
                      return (
                        <td key={mId} className="px-3 py-2.5 text-center">
                          <span className={`text-sm font-bold ${scoreColor(cell.compositeScore)}`}>{cell.compositeScore}</span>
                          <div className="text-sm text-muted-foreground/60 mt-0.5">${cell.totalCost.toFixed(4)}</div>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2.5 text-center">
                      <span className={`text-sm font-bold ${scoreColor(agg?.compositeScore ?? 0)}`}>{agg?.compositeScore ?? 0}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
