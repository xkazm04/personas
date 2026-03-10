import { Target, FileText, Shield, DollarSign, Clock, ArrowUp, ArrowDown } from 'lucide-react';
import { scoreColor } from '@/lib/eval/evalFramework';

interface VariantScores {
  avgToolAccuracy: number;
  avgOutputQuality: number;
  avgProtocolCompliance: number;
  compositeScore: number;
  totalCost: number;
  avgDuration: number;
}

interface MatrixScoreComparisonProps {
  currentAgg: VariantScores | undefined;
  draftAgg: VariantScores | undefined;
}

export function MatrixScoreComparison({ currentAgg, draftAgg }: MatrixScoreComparisonProps) {
  if (!currentAgg || !draftAgg) return null;

  const rows = [
    { label: 'Tool Accuracy', icon: Target, current: currentAgg.avgToolAccuracy, draft: draftAgg.avgToolAccuracy },
    { label: 'Output Quality', icon: FileText, current: currentAgg.avgOutputQuality, draft: draftAgg.avgOutputQuality },
    { label: 'Protocol', icon: Shield, current: currentAgg.avgProtocolCompliance, draft: draftAgg.avgProtocolCompliance },
    { label: 'Composite', icon: null as typeof Target | null, current: currentAgg.compositeScore, draft: draftAgg.compositeScore },
  ];

  return (
    <div className="space-y-2">
      <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
        <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
        Score Comparison
      </h4>
      <div className="overflow-x-auto border border-primary/10 rounded-xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-primary/10 bg-secondary/30">
              <th className="text-left px-3 py-2.5 font-medium text-muted-foreground/80">Metric</th>
              <th className="text-center px-3 py-2.5 font-medium text-muted-foreground/80">Current</th>
              <th className="text-center px-3 py-2.5 font-medium text-violet-400">Draft</th>
              <th className="text-center px-3 py-2.5 font-medium text-muted-foreground/80">Delta</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const d = row.draft - row.current;
              return (
                <tr key={row.label} className="border-b border-primary/5">
                  <td className="px-3 py-2.5 text-foreground/80 font-medium flex items-center gap-1.5">
                    {row.icon && <row.icon className="w-3.5 h-3.5 text-muted-foreground/80" />}
                    {row.label}
                  </td>
                  <td className={`px-3 py-2.5 text-center font-bold ${scoreColor(row.current)}`}>{row.current}</td>
                  <td className={`px-3 py-2.5 text-center font-bold ${scoreColor(row.draft)}`}>{row.draft}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`inline-flex items-center gap-0.5 font-medium ${
                      d > 0 ? 'text-emerald-400' : d < 0 ? 'text-red-400' : 'text-muted-foreground/60'
                    }`}>
                      {d > 0 ? <ArrowUp className="w-3 h-3" /> : d < 0 ? <ArrowDown className="w-3 h-3" /> : null}
                      {d > 0 ? '+' : ''}{d}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-6 text-sm text-muted-foreground/80 px-1">
        <span className="flex items-center gap-1">
          <DollarSign className="w-3 h-3" />Current: ${currentAgg.totalCost.toFixed(4)}
        </span>
        <span className="flex items-center gap-1">
          <DollarSign className="w-3 h-3" />Draft: ${draftAgg.totalCost.toFixed(4)}
        </span>
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />Current: {(currentAgg.avgDuration / 1000).toFixed(1)}s
        </span>
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />Draft: {(draftAgg.avgDuration / 1000).toFixed(1)}s
        </span>
      </div>
    </div>
  );
}
