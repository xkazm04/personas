import { DollarSign, Zap, CheckCircle, TrendingUp } from 'lucide-react';

interface AnalyticsSummaryCardsProps {
  totalCost: number;
  totalExecutions: number;
  successRate: string;
  activePersonas: number;
}

export function AnalyticsSummaryCards({ totalCost, totalExecutions, successRate, activePersonas }: AnalyticsSummaryCardsProps) {
  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-sm font-semibold border bg-emerald-500/10 border-emerald-500/20 text-emerald-300">
        <DollarSign className="w-3 h-3" />${totalCost.toFixed(2)}
      </span>
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-sm font-semibold border bg-blue-500/10 border-blue-500/20 text-blue-300">
        <Zap className="w-3 h-3" />{totalExecutions}
      </span>
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-sm font-semibold border bg-green-500/10 border-green-500/20 text-green-300">
        <CheckCircle className="w-3 h-3" />{successRate}%
      </span>
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-sm font-semibold border bg-purple-500/10 border-purple-500/20 text-purple-300">
        <TrendingUp className="w-3 h-3" />{activePersonas}
      </span>
    </div>
  );
}
