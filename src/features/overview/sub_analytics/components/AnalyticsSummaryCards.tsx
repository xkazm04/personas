import { DollarSign, Zap, CheckCircle, TrendingUp } from 'lucide-react';
import type { MetricTrends } from '@/features/overview/utils/computeTrends';
import { TrendIndicator } from '@/features/overview/components/shared/TrendIndicator';

interface AnalyticsSummaryCardsProps {
  totalCost: number;
  totalExecutions: number;
  successRate: string;
  activePersonas: number;
  trends?: MetricTrends | null;
}

export function AnalyticsSummaryCards({ totalCost, totalExecutions, successRate, activePersonas, trends }: AnalyticsSummaryCardsProps) {
  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-modal typo-heading font-semibold border bg-emerald-500/10 border-emerald-500/20 text-emerald-300">
        <DollarSign className="w-3 h-3" />${totalCost.toFixed(2)}
        {trends?.cost && <TrendIndicator trend={trends.cost} invertPolarity />}
      </span>
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-modal typo-heading font-semibold border bg-blue-500/10 border-blue-500/20 text-blue-300">
        <Zap className="w-3 h-3" />{totalExecutions}
        {trends?.executions && <TrendIndicator trend={trends.executions} />}
      </span>
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-modal typo-heading font-semibold border bg-green-500/10 border-green-500/20 text-green-300">
        <CheckCircle className="w-3 h-3" />{successRate}%
        {trends?.successRate && <TrendIndicator trend={trends.successRate} />}
      </span>
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-modal typo-heading font-semibold border bg-purple-500/10 border-purple-500/20 text-purple-300">
        <TrendingUp className="w-3 h-3" />{activePersonas}
      </span>
    </div>
  );
}
