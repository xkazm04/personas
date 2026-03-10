import { Trophy } from 'lucide-react';
import { scoreColor } from '../shared/labUtils';
import type { CellAggregate, VersionAggregate } from './evalAggregation';

interface Props {
  versions: string[];
  models: string[];
  grid: Record<string, Record<string, CellAggregate>>;
  versionAggs: VersionAggregate[];
  winnerId: string | null;
}

export function EvalMatrixTable({ versions, models, grid, versionAggs, winnerId }: Props) {
  return (
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
                <th key={m} className="text-center px-3 py-2.5 font-medium text-muted-foreground/80">
                  {m}
                </th>
              ))}
              <th className="text-center px-3 py-2.5 font-medium text-muted-foreground/80">Avg</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((vId) => {
              const agg = versionAggs.find((a) => a.versionId === vId);
              const isWinner = vId === winnerId;
              return (
                <tr
                  key={vId}
                  className={`border-b border-primary/5 transition-colors ${isWinner ? 'bg-primary/5' : 'hover:bg-secondary/10'}`}
                >
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
                        <span className={`text-sm font-bold ${scoreColor(cell.compositeScore)}`}>
                          {cell.compositeScore}
                        </span>
                        <div className="text-sm text-muted-foreground/60 mt-0.5">
                          ${cell.totalCost.toFixed(4)}
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-3 py-2.5 text-center">
                    <span className={`text-sm font-bold ${scoreColor(agg?.compositeScore ?? 0)}`}>
                      {agg?.compositeScore ?? 0}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
