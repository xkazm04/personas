import { Trophy, DollarSign, Clock, Target, FileText, Shield } from 'lucide-react';

export interface ModelAggregate {
  modelId: string;
  provider: string;
  avgToolAccuracy: number;
  avgOutputQuality: number;
  avgProtocolCompliance: number;
  compositeScore: number;
  totalCost: number;
  avgDuration: number;
  count: number;
}

export function scoreColor(score: number | null): string {
  if (score === null) return 'text-muted-foreground/80';
  if (score >= 80) return 'text-emerald-400';
  if (score >= 50) return 'text-amber-400';
  return 'text-red-400';
}

interface ModelRankingsProps {
  aggregates: ModelAggregate[];
  bestModelId: string | null;
}

export function ModelRankings({ aggregates, bestModelId }: ModelRankingsProps) {
  return (
    <div className="space-y-2">
      <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
        <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
        <Trophy className="w-3.5 h-3.5" />
        Model Rankings
      </h4>
      <div className="grid gap-2">
        {aggregates.map((agg, idx) => (
          <div
            key={agg.modelId}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
              agg.modelId === bestModelId
                ? 'bg-primary/5 border-primary/20'
                : 'bg-background/30 border-primary/10'
            }`}
          >
            <span className="text-lg font-bold text-muted-foreground/80 w-6 text-center">
              {idx + 1}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">{agg.modelId}</span>
                <span className="text-sm text-muted-foreground/80">{agg.provider}</span>
                {agg.modelId === bestModelId && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-sm font-medium bg-primary/15 text-primary border border-primary/20">
                    <Trophy className="w-3 h-3" /> Best
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4 text-sm">
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
              <div className="w-px h-4 bg-primary/10" />
              <div className="flex items-center gap-1" title="Composite Score">
                <span className={`text-sm font-bold ${scoreColor(agg.compositeScore)}`}>
                  {agg.compositeScore}
                </span>
              </div>
              <div className="w-px h-4 bg-primary/10" />
              <div className="flex items-center gap-1 text-muted-foreground/90" title="Total Cost">
                <DollarSign className="w-3 h-3" />
                <span>${agg.totalCost.toFixed(4)}</span>
              </div>
              <div className="flex items-center gap-1 text-muted-foreground/90" title="Avg Duration">
                <Clock className="w-3 h-3" />
                <span>{(agg.avgDuration / 1000).toFixed(1)}s</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
