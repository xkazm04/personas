import { estimateCost } from '@/lib/utils/platform/pricing';
import { formatCost } from './inspectorTypes';

export function CostBreakdownBar({ model, inputTokens, outputTokens }: { model: string; inputTokens: number; outputTokens: number }) {
  const { inputCost, outputCost, totalCost, estimated } = estimateCost(model, inputTokens, outputTokens);
  const inputPct = totalCost > 0 ? (inputCost / totalCost) * 100 : 50;
  const outputPct = totalCost > 0 ? (outputCost / totalCost) * 100 : 50;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="text-sm font-mono text-muted-foreground/80 uppercase tracking-wider">Cost Breakdown</div>
        {estimated && (
          <span className="text-sm px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400/80 font-medium">
            Unknown model -- no pricing data
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 text-sm font-mono">
        <span className="text-blue-400">Input: {formatCost(inputCost)}</span>
        <span className="text-muted-foreground/80">|</span>
        <span className="text-amber-400">Output: {formatCost(outputCost)}</span>
        <span className="text-muted-foreground/80">|</span>
        <span className="text-foreground/90">Total: {formatCost(totalCost)}</span>
      </div>
      <div className="h-2.5 rounded-full overflow-hidden bg-secondary/60 border border-primary/10 flex">
        <div
          className="h-full bg-blue-500/40 transition-all"
          style={{ width: `${inputPct}%` }}
        />
        <div
          className="h-full bg-amber-500/40 transition-all"
          style={{ width: `${outputPct}%` }}
        />
      </div>
      <div className="flex justify-between text-sm font-mono text-muted-foreground/80">
        <span>Input ({inputPct.toFixed(0)}%)</span>
        <span>Output ({outputPct.toFixed(0)}%)</span>
      </div>
    </div>
  );
}
