import { useState, useMemo } from 'react';
import type { DbPersonaExecution } from '@/lib/types/types';
import { Wrench, Clock, DollarSign, ChevronDown, ChevronRight, Zap, Hash } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDuration } from '@/lib/utils/formatters';
import { estimateCost } from '@/lib/utils/pricing';

interface ToolCallStep {
  step_index: number;
  tool_name: string;
  input_preview: string;
  output_preview: string;
  started_at_ms: number;
  ended_at_ms?: number;
  duration_ms?: number;
}

interface ExecutionInspectorProps {
  execution: DbPersonaExecution;
}

function parseToolSteps(raw: string | null): ToolCallStep[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function durationColor(ms: number | undefined): string {
  if (ms === undefined) return 'bg-secondary/60 text-muted-foreground/60 border-primary/15';
  if (ms < 2000) return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20';
  if (ms < 10000) return 'bg-amber-500/15 text-amber-400 border-amber-500/20';
  return 'bg-red-500/15 text-red-400 border-red-500/20';
}

function formatCost(value: number): string {
  if (value < 0.001) return '<$0.001';
  return `$${value.toFixed(4)}`;
}

function ToolCallCard({ step }: { step: ToolCallStep }) {
  const [showInput, setShowInput] = useState(false);
  const [showOutput, setShowOutput] = useState(false);

  return (
    <div className="rounded-xl border border-primary/15 bg-secondary/40 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
          <Hash className="w-3.5 h-3.5 text-primary/70" />
        </div>
        <span className="text-[11px] font-mono text-muted-foreground/50">{step.step_index + 1}</span>

        <div className="flex items-center gap-1.5">
          <Wrench className="w-3.5 h-3.5 text-muted-foreground/50" />
          <span className="text-sm font-medium text-foreground/90 font-mono">{step.tool_name}</span>
        </div>

        <div className="ml-auto">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono border ${durationColor(step.duration_ms)}`}>
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
            className="flex items-center gap-2 w-full px-4 py-2 text-xs text-muted-foreground/50 hover:text-foreground/70 transition-colors"
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
                <pre className="px-4 pb-3 text-xs text-foreground/70 font-mono whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
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
            className="flex items-center gap-2 w-full px-4 py-2 text-xs text-muted-foreground/50 hover:text-foreground/70 transition-colors"
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
                <pre className="px-4 pb-3 text-xs text-foreground/70 font-mono whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
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

function CostBreakdownBar({ model, inputTokens, outputTokens }: { model: string; inputTokens: number; outputTokens: number }) {
  const { inputCost, outputCost, totalCost } = estimateCost(model, inputTokens, outputTokens);
  const inputPct = totalCost > 0 ? (inputCost / totalCost) * 100 : 50;
  const outputPct = totalCost > 0 ? (outputCost / totalCost) * 100 : 50;

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-mono text-muted-foreground/40 uppercase tracking-wider">Cost Breakdown</div>
      <div className="flex items-center gap-3 text-xs font-mono">
        <span className="text-blue-400">Input: {formatCost(inputCost)}</span>
        <span className="text-muted-foreground/30">|</span>
        <span className="text-amber-400">Output: {formatCost(outputCost)}</span>
        <span className="text-muted-foreground/30">|</span>
        <span className="text-foreground/70">Total: {formatCost(totalCost)}</span>
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
      <div className="flex justify-between text-[10px] font-mono text-muted-foreground/40">
        <span>Input ({inputPct.toFixed(0)}%)</span>
        <span>Output ({outputPct.toFixed(0)}%)</span>
      </div>
    </div>
  );
}

export function ExecutionInspector({ execution }: ExecutionInspectorProps) {
  const steps = useMemo(() => parseToolSteps(execution.tool_steps ?? null), [execution.tool_steps]);
  const model = execution.model_used || 'claude-sonnet-4';

  return (
    <div className="space-y-6">
      {/* Metrics Summary Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-xl border border-primary/15 bg-secondary/40 p-4 space-y-1.5">
          <div className="text-[11px] font-mono text-muted-foreground/40 uppercase tracking-wider flex items-center gap-1">
            <Zap className="w-3 h-3" />
            Input Tokens
          </div>
          <div className="text-lg font-mono text-foreground/90">
            {execution.input_tokens.toLocaleString()}
          </div>
        </div>

        <div className="rounded-xl border border-primary/15 bg-secondary/40 p-4 space-y-1.5">
          <div className="text-[11px] font-mono text-muted-foreground/40 uppercase tracking-wider flex items-center gap-1">
            <Zap className="w-3 h-3" />
            Output Tokens
          </div>
          <div className="text-lg font-mono text-foreground/90">
            {execution.output_tokens.toLocaleString()}
          </div>
        </div>

        <div className="rounded-xl border border-primary/15 bg-secondary/40 p-4 space-y-1.5">
          <div className="text-[11px] font-mono text-muted-foreground/40 uppercase tracking-wider flex items-center gap-1">
            <DollarSign className="w-3 h-3" />
            Cost
          </div>
          <div className="text-lg font-mono text-foreground/90">
            {formatCost(execution.cost_usd)}
          </div>
        </div>

        <div className="rounded-xl border border-primary/15 bg-secondary/40 p-4 space-y-1.5">
          <div className="text-[11px] font-mono text-muted-foreground/40 uppercase tracking-wider flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Duration
          </div>
          <div className="text-lg font-mono text-foreground/90">
            {formatDuration(execution.duration_ms)}
          </div>
        </div>
      </div>

      {/* Cost Breakdown Bar */}
      <div className="rounded-xl border border-primary/15 bg-secondary/40 p-4">
        <CostBreakdownBar model={model} inputTokens={execution.input_tokens} outputTokens={execution.output_tokens} />
      </div>

      {/* Tool Call Timeline */}
      {steps.length > 0 && (
        <div className="space-y-3">
          <div className="text-[11px] font-mono text-muted-foreground/40 uppercase tracking-wider flex items-center gap-1.5">
            <Wrench className="w-3 h-3" />
            Tool Call Timeline ({steps.length} steps)
          </div>

          <div className="space-y-2">
            {steps.map((step) => (
              <ToolCallCard key={step.step_index} step={step} />
            ))}
          </div>
        </div>
      )}

      {steps.length === 0 && (
        <div className="text-center py-8">
          <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-secondary/60 border border-primary/15 flex items-center justify-center">
            <Wrench className="w-6 h-6 text-muted-foreground/30" />
          </div>
          <p className="text-sm text-muted-foreground/50">No tool calls recorded</p>
          <p className="text-xs text-muted-foreground/30 mt-1">Tool steps appear after execution completes</p>
        </div>
      )}
    </div>
  );
}
