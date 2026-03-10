import { useState } from 'react';
import { Clock, ChevronDown, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDuration } from '@/lib/utils/formatters';
import { estimateCost } from '@/lib/utils/platform/pricing';
import type { ToolCallStep } from '../../libs/inspectorHelpers';
import { durationColor, formatCost } from '../../libs/inspectorHelpers';
import { Wrench, Hash } from 'lucide-react';

export function ToolCallCard({ step }: { step: ToolCallStep }) {
  const [showInput, setShowInput] = useState(false);
  const [showOutput, setShowOutput] = useState(false);

  return (
    <div className="rounded-xl border border-primary/15 bg-secondary/40 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
          <Hash className="w-3.5 h-3.5 text-primary/70" />
        </div>
        <span className="text-sm font-mono text-muted-foreground/90">{step.step_index + 1}</span>

        <div className="flex items-center gap-1.5">
          <Wrench className="w-3.5 h-3.5 text-muted-foreground/90" />
          <span className="text-sm font-medium text-foreground/90 font-mono">{step.tool_name}</span>
        </div>

        <div className="ml-auto">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-sm font-mono border ${durationColor(step.duration_ms)}`}>
            <Clock className="w-3 h-3" />
            {step.duration_ms !== undefined ? formatDuration(step.duration_ms) : 'pending'}
          </span>
        </div>
      </div>

      {/* Collapsible Input */}
      {step.input_preview && (
        <div className="border-t border-primary/10">
          <button
            onClick={() => setShowInput(!showInput)}
            className="flex items-center gap-2 w-full px-4 py-2 text-sm text-muted-foreground/90 hover:text-foreground/95 transition-colors"
          >
            {showInput ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            Input
          </button>
          <AnimatePresence>
            {showInput && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.15 }}
              >
                <pre className="px-4 pb-3 text-sm text-foreground/90 font-mono whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                  {step.input_preview}
                </pre>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Collapsible Output */}
      {step.output_preview && (
        <div className="border-t border-primary/10">
          <button
            onClick={() => setShowOutput(!showOutput)}
            className="flex items-center gap-2 w-full px-4 py-2 text-sm text-muted-foreground/90 hover:text-foreground/95 transition-colors"
          >
            {showOutput ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            Output
          </button>
          <AnimatePresence>
            {showOutput && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.15 }}
              >
                <pre className="px-4 pb-3 text-sm text-foreground/90 font-mono whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                  {step.output_preview}
                </pre>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

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
            Unknown model — no pricing data
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
