import { Trophy, Target, FileText, Shield, DollarSign, Clock } from 'lucide-react';
import { scoreColor } from '../libs/labUtils';
import type { VersionAggregate } from '../libs/evalAggregation';

interface EvalVersionCardsProps {
  versionAggs: VersionAggregate[];
  winnerId: string | null;
  celebrateWinnerId: string | null;
}

export function EvalVersionCards({ versionAggs, winnerId, celebrateWinnerId }: EvalVersionCardsProps) {
  const colors = ['blue', 'violet', 'emerald', 'amber', 'rose', 'cyan'];

  return (
    <div className="space-y-2">
      <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
        <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
        <Trophy className="w-3.5 h-3.5" />
        Version Rankings
      </h4>
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(versionAggs.length, 4)}, 1fr)` }}>
        {versionAggs.map((agg, idx) => {
          const isWinner = agg.versionId === winnerId;
          const color = colors[idx % colors.length];
          return (
            <div key={agg.versionId} data-testid={`eval-version-card-${agg.versionNumber}`}
              className={`rounded-xl border p-4 space-y-3 ${
                isWinner
                  ? `bg-primary/5 border-primary/20 ${celebrateWinnerId === agg.versionId ? 'ring-1 ring-primary/20 shadow-[0_0_14px_rgba(99,102,241,0.18)]' : ''}`
                  : 'bg-background/30 border-primary/10'
              }`}>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-sm font-mono font-bold bg-${color}-500/15 text-${color}-400`}>
                  v{agg.versionNumber}
                </span>
                {isWinner && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-sm font-medium bg-primary/15 text-primary border border-primary/20">
                    <Trophy className="w-3 h-3 animate-[pulse_3s_ease-in-out_infinite] motion-reduce:animate-none" /> Winner
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="flex items-center gap-1.5" title="Tool Accuracy">
                  <Target className="w-3.5 h-3.5 text-muted-foreground/80" />
                  <span className={scoreColor(agg.avgToolAccuracy)}>{agg.avgToolAccuracy}</span>
                </div>
                <div className="flex items-center gap-1.5" title="Output Quality">
                  <FileText className="w-3.5 h-3.5 text-muted-foreground/80" />
                  <span className={scoreColor(agg.avgOutputQuality)}>{agg.avgOutputQuality}</span>
                </div>
                <div className="flex items-center gap-1.5" title="Protocol Compliance">
                  <Shield className="w-3.5 h-3.5 text-muted-foreground/80" />
                  <span className={scoreColor(agg.avgProtocolCompliance)}>{agg.avgProtocolCompliance}</span>
                </div>
              </div>

              <div className="flex items-center gap-3 text-sm">
                <span className={`font-bold text-lg ${scoreColor(agg.compositeScore)}`}>{agg.compositeScore}</span>
                <span className="text-muted-foreground/60">composite</span>
                <div className="flex-1" />
                <div className="flex items-center gap-1 text-muted-foreground/90">
                  <DollarSign className="w-3 h-3" /><span>${agg.totalCost.toFixed(4)}</span>
                </div>
                <div className="flex items-center gap-1 text-muted-foreground/90">
                  <Clock className="w-3 h-3" /><span>{(agg.avgDuration / 1000).toFixed(1)}s</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
