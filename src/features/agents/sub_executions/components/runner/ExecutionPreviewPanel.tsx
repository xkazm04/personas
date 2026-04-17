import { useState, useCallback } from 'react';
import { Eye, DollarSign, Brain, Wrench, Zap, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { previewExecution, type ExecutionPreview } from '@/api/agents/executions';
import { useTranslation } from '@/i18n/useTranslation';

interface ExecutionPreviewPanelProps {
  personaId: string;
  inputData?: string;
  useCaseId?: string;
}

function fmtCost(usd: number): string {
  if (usd < 0.001) return '<$0.001';
  if (usd < 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function ExecutionPreviewPanel({ personaId, inputData, useCaseId }: ExecutionPreviewPanelProps) {
  const { t, tx } = useTranslation();
  const e = t.agents.executions;
  const [preview, setPreview] = useState<ExecutionPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await previewExecution(personaId, inputData, useCaseId);
      setPreview(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [personaId, inputData, useCaseId]);

  // Show button to load preview
  if (!preview && !loading) {
    return (
      <button
        onClick={loadPreview}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-card bg-secondary/40 text-foreground hover:text-foreground/80 hover:bg-secondary/60 border border-primary/10 transition-colors"
        title="Preview execution cost and prompt"
      >
        <Eye className="w-3 h-3" />
        {e.preview}
      </button>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-foreground">
        <div className="w-3 h-3 border border-primary/30 border-t-primary rounded-full animate-spin" />
        {e.estimating}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-red-400/70">
        <AlertTriangle className="w-3 h-3" />
        {error}
      </div>
    );
  }

  if (!preview) return null;

  const budgetPct = preview.budget_limit > 0
    ? ((preview.monthly_spend + preview.estimated_total_cost) / preview.budget_limit) * 100
    : 0;
  const overBudget = budgetPct > 100;
  const nearBudget = budgetPct > 80;

  return (
    <div className="rounded-card border border-primary/10 bg-secondary/20 overflow-hidden">
      {/* Compact summary row */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-3 py-2 text-xs hover:bg-secondary/30 transition-colors"
      >
        <div className="flex items-center gap-1.5 text-foreground">
          <DollarSign className="w-3 h-3 text-emerald-400" />
          <span className="font-mono font-medium">{fmtCost(preview.estimated_total_cost)}</span>
          <span className="text-foreground">{e.est}</span>
        </div>
        <div className="flex items-center gap-1.5 text-foreground">
          <Zap className="w-3 h-3" />
          <span className="font-mono">{fmtTokens(preview.estimated_input_tokens)}</span>
          <span>in</span>
          <span className="font-mono">{fmtTokens(preview.estimated_output_tokens)}</span>
          <span>out</span>
        </div>
        <div className="flex items-center gap-1.5 text-foreground">
          <Brain className="w-3 h-3" />
          <span>{preview.memory_count}</span>
        </div>
        <div className="flex items-center gap-1.5 text-foreground">
          <Wrench className="w-3 h-3" />
          <span>{preview.tool_count}</span>
        </div>
        {(overBudget || nearBudget) && (
          <div className={`flex items-center gap-1 ${overBudget ? 'text-red-400' : 'text-amber-400'}`}>
            <AlertTriangle className="w-3 h-3" />
            <span>{tx(e.of_budget, { percent: Math.round(budgetPct) })}</span>
          </div>
        )}
        <div className="ml-auto text-foreground">
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 py-2 border-t border-primary/5 space-y-2">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-foreground uppercase tracking-wider text-[10px]">{e.model}</span>
              <div className="text-foreground font-mono truncate">{preview.model}</div>
            </div>
            <div>
              <span className="text-foreground uppercase tracking-wider text-[10px]">{e.monthly_spend}</span>
              <div className="text-foreground font-mono">{fmtCost(preview.monthly_spend)} / {preview.budget_limit > 0 ? fmtCost(preview.budget_limit) : e.unlimited}</div>
            </div>
            <div>
              <span className="text-foreground uppercase tracking-wider text-[10px]">{e.input_cost}</span>
              <div className="text-foreground font-mono">{fmtCost(preview.estimated_input_cost)}</div>
            </div>
            <div>
              <span className="text-foreground uppercase tracking-wider text-[10px]">{e.output_cost_est}</span>
              <div className="text-foreground font-mono">{fmtCost(preview.estimated_output_cost)}</div>
            </div>
          </div>

          {/* Prompt preview (first 500 chars) */}
          <div>
            <span className="text-foreground uppercase tracking-wider text-[10px]">{e.prompt_preview}</span>
            <pre className="mt-1 text-[11px] font-mono text-foreground leading-relaxed bg-black/10 rounded-input p-2 max-h-32 overflow-y-auto whitespace-pre-wrap">
              {preview.prompt_preview.slice(0, 500)}{preview.prompt_preview.length > 500 ? '...' : ''}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
