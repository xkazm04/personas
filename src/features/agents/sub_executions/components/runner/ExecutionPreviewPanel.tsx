import { useState, useCallback } from 'react';
import { Eye, DollarSign, Brain, Wrench, Zap, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { previewExecution, type ExecutionPreview } from '@/api/agents/executions';
import { useTranslation } from '@/i18n/useTranslation';
import { fmtCost as fmtCostBase, fmtTokens as fmtTokensBase } from '../../libs/comparisonHelpers';
import { extractMessage } from '@/lib/silentCatch';
import Button from '@/features/shared/components/buttons/Button';
import { PressSurface } from '@/features/shared/components/buttons/PressSurface';

interface ExecutionPreviewPanelProps {
  personaId: string;
  inputData?: string;
  useCaseId?: string;
}

const fmtCost = (usd: number) => fmtCostBase(usd, { precision: 'auto' });
const fmtTokens = (n: number) => fmtTokensBase(n, { withMillions: true });

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
      setError(extractMessage(err));
    } finally {
      setLoading(false);
    }
  }, [personaId, inputData, useCaseId]);

  // Show button to load preview
  if (!preview && !loading) {
    return (
      <Button
        type="button"
        onClick={loadPreview}
        tooltip={e.preview}
        variant="secondary"
        size="sm"
        icon={<Eye className="w-3 h-3" />}
      >{e.preview}</Button>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 typo-caption text-ink-2">
        <div className="w-3 h-3 border border-primary/30 border-t-primary rounded-full animate-spin" />
        {e.estimating}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 typo-caption text-status-error">
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
    <div className="rounded-card border border-hair bg-surface-1 overflow-hidden">
      {/* Compact summary row */}
      <PressSurface
        onPress={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-3 py-2 typo-caption"
      >
        <div className="flex items-center gap-1.5 text-ink-1">
          <DollarSign className="w-3 h-3 text-status-success" />
          <span className="font-mono font-medium">{fmtCost(preview.estimated_total_cost)}</span>
          <span className="text-ink-1">{e.est}</span>
        </div>
        <div className="flex items-center gap-1.5 text-ink-1">
          <Zap className="w-3 h-3" />
          <span className="font-mono">{fmtTokens(Number(preview.estimated_input_tokens))}</span>
          <span>in</span>
          <span className="font-mono">{fmtTokens(Number(preview.estimated_output_tokens))}</span>
          <span>out</span>
        </div>
        <div className="flex items-center gap-1.5 text-ink-1">
          <Brain className="w-3 h-3" />
          <span>{preview.memory_count}</span>
        </div>
        <div className="flex items-center gap-1.5 text-ink-1">
          <Wrench className="w-3 h-3" />
          <span>{preview.tool_count}</span>
        </div>
        {(overBudget || nearBudget) && (
          <div className={`flex items-center gap-1 ${overBudget ? 'text-status-error' : 'text-status-warning'}`}>
            <AlertTriangle className="w-3 h-3" />
            <span>{tx(e.of_budget, { percent: Math.round(budgetPct) })}</span>
          </div>
        )}
        <div className="ml-auto text-ink-1">
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </div>
      </PressSurface>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 py-2 border-t border-hair space-y-2">
          <div className="grid grid-cols-2 gap-2 typo-caption">
            <div>
              <span className="text-ink-1 typo-eyebrow">{e.model}</span>
              <div className="text-ink-1 font-mono truncate">{preview.model}</div>
            </div>
            <div>
              <span className="text-ink-1 typo-eyebrow">{e.monthly_spend}</span>
              <div className="text-ink-1 font-mono">{fmtCost(preview.monthly_spend)} / {preview.budget_limit > 0 ? fmtCost(preview.budget_limit) : e.unlimited}</div>
            </div>
            <div>
              <span className="text-ink-1 typo-eyebrow">{e.input_cost}</span>
              <div className="text-ink-1 font-mono">{fmtCost(preview.estimated_input_cost)}</div>
            </div>
            <div>
              <span className="text-ink-1 typo-eyebrow">{e.output_cost_est}</span>
              <div className="text-ink-1 font-mono">{fmtCost(preview.estimated_output_cost)}</div>
            </div>
          </div>

          {/* Prompt preview (first 500 chars) */}
          <div>
            <span className="text-ink-1 typo-eyebrow">{e.prompt_preview}</span>
            <pre className="mt-1 typo-caption font-mono text-ink-1 leading-relaxed bg-black/10 rounded-input p-2 max-h-32 overflow-y-auto whitespace-pre-wrap">
              {preview.prompt_preview.slice(0, 500)}{preview.prompt_preview.length > 500 ? '...' : ''}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
