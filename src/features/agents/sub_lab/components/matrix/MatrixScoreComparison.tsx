import { Target, FileText, Shield, DollarSign, Clock, ArrowUp, ArrowDown } from 'lucide-react';
import { scoreColor } from '@/lib/eval/evalFramework';
import { useTranslation } from '@/i18n/useTranslation';

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
  const { t } = useTranslation();
  if (!currentAgg || !draftAgg) return null;

  const rows = [
    { label: t.agents.lab.tool_accuracy, icon: Target, current: currentAgg.avgToolAccuracy, draft: draftAgg.avgToolAccuracy },
    { label: t.agents.lab.output_quality, icon: FileText, current: currentAgg.avgOutputQuality, draft: draftAgg.avgOutputQuality },
    { label: t.agents.lab.protocol, icon: Shield, current: currentAgg.avgProtocolCompliance, draft: draftAgg.avgProtocolCompliance },
    { label: t.agents.lab.composite_label, icon: null as typeof Target | null, current: currentAgg.compositeScore, draft: draftAgg.compositeScore },
  ];

  return (
    <div className="space-y-2">
      <h4 className="flex items-center gap-2.5 typo-heading font-semibold text-foreground/90 tracking-wide">
        <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
        {t.agents.lab.score_comparison}
      </h4>
      <div className="overflow-x-auto border border-primary/10 rounded-modal">
        <table className="w-full typo-body">
          <thead>
            <tr className="border-b border-primary/10 bg-secondary/30">
              <th className="text-left px-3 py-2.5 font-medium text-foreground">{t.agents.lab.metric_column}</th>
              <th className="text-center px-3 py-2.5 font-medium text-foreground">{t.agents.lab.current_column}</th>
              <th className="text-center px-3 py-2.5 font-medium text-violet-400">Draft</th>
              <th className="text-center px-3 py-2.5 font-medium text-foreground">{t.agents.lab.delta_column}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const d = row.draft - row.current;
              return (
                <tr key={row.label} className="border-b border-primary/10">
                  <td className="px-3 py-2.5 text-foreground font-medium flex items-center gap-1.5">
                    {row.icon && <row.icon className="w-3.5 h-3.5 text-foreground" />}
                    {row.label}
                  </td>
                  <td className={`px-3 py-2.5 text-center font-bold ${scoreColor(row.current)}`}>{row.current}</td>
                  <td className={`px-3 py-2.5 text-center font-bold ${scoreColor(row.draft)}`}>{row.draft}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`inline-flex items-center gap-0.5 font-medium ${
                      d > 0 ? 'text-emerald-400' : d < 0 ? 'text-red-400' : 'text-foreground'
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

      <div className="flex items-center gap-6 typo-body text-foreground px-1">
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
