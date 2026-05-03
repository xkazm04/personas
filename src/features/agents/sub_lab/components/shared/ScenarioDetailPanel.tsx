import { useEffect, useState } from 'react';
import { Target, FileText, Shield, Lightbulb, MessageSquare, X, ChevronDown, Zap } from 'lucide-react';
import { compositeScoreFromRow, scoreColor } from '@/lib/eval/evalFramework';
import { UserRating } from './UserRating';
import { LabEventStream } from './LabEventStream';
import { labGetToolCalls } from '@/api/agents/lab';
import { silentCatch } from '@/lib/silentCatch';
import type { LabResultKind } from '@/lib/bindings/LabResultKind';
import type { LabToolCall } from '@/lib/bindings/LabToolCall';
import { useTranslation } from '@/i18n/useTranslation';

interface ScenarioResult {
  scenarioName: string;
  modelId?: string;
  status: string;
  toolAccuracyScore: number | null;
  outputQualityScore: number | null;
  protocolCompliance: number | null;
  outputPreview: string | null;
  costUsd: number;
  durationMs: number;
  errorMessage: string | null;
  rationale: string | null;
  suggestions: string | null;
}

interface StructuredRationale {
  summary?: string;
  verdict?: string;
  tool_accuracy?: string;
  output_quality?: string;
  protocol?: string;
}

interface ScenarioDetailPanelProps {
  result: ScenarioResult;
  onClose: () => void;
  rating?: number;
  ratingFeedback?: string;
  onRate?: (rating: number, feedback?: string) => void;
  /** When provided alongside `resultKind`, renders the captured CLI event stream
   *  for this scenario. Forward-only — older results have no events to render. */
  resultId?: string;
  resultKind?: LabResultKind;
}

/** Try to parse structured rationale JSON, fall back to plain string. */
function parseRationale(raw: string | null): { structured: StructuredRationale | null; plain: string | null } {
  if (!raw) return { structured: null, plain: null };
  try {
    const parsed = JSON.parse(raw) as StructuredRationale;
    if (typeof parsed === 'object' && parsed !== null && (parsed.tool_accuracy || parsed.output_quality || parsed.protocol || parsed.verdict)) {
      return { structured: parsed, plain: null };
    }
  } catch { /* not JSON — treat as plain string */ }
  return { structured: null, plain: raw };
}

function scoreLabel(score: number | null): string {
  if (score == null) return 'Unscored';
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  if (score >= 20) return 'Weak';
  return 'Poor';
}

function ScoreCard({ label, icon: Icon, score, rationale, color, borderColor }: {
  label: string;
  icon: typeof Target;
  score: number | null;
  rationale?: string;
  color: string;
  borderColor: string;
}) {
  // Unscored metric — render an empty bar and "—" rather than collapsing to 0,
  // which would visually conflate "not scored" with "scored zero".
  const isUnscored = score == null;
  const barWidth = isUnscored ? 0 : Math.max(score, 2);
  const barClass = isUnscored
    ? 'bg-secondary/40'
    : score >= 80 ? 'bg-emerald-500/70'
    : score >= 50 ? 'bg-amber-500/70'
    : 'bg-red-500/60';
  return (
    <div className={`rounded-modal border ${borderColor} bg-background/30 overflow-hidden`}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <Icon className={`w-4 h-4 ${color} flex-shrink-0`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="typo-caption font-medium text-foreground">{label}</span>
            <span className={`typo-caption font-semibold ${scoreColor(score)}`}>{scoreLabel(score)}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-primary/5 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${barClass}`}
              style={{ width: `${barWidth}%` }}
            />
          </div>
        </div>
        <span className={`typo-heading-lg font-bold tabular-nums ${scoreColor(score)}`}>{score ?? '—'}</span>
      </div>
      {rationale && (
        <div className="px-3 pb-2.5 -mt-0.5">
          <p className="typo-caption text-foreground leading-relaxed">{rationale}</p>
        </div>
      )}
    </div>
  );
}

export function ScenarioDetailPanel({ result, onClose, rating, ratingFeedback, onRate, resultId, resultKind }: ScenarioDetailPanelProps) {
  const { t } = useTranslation();
  const ta = result.toolAccuracyScore;
  const oq = result.outputQualityScore;
  const pc = result.protocolCompliance;
  const composite = compositeScoreFromRow(ta, oq, pc);

  const { structured, plain } = parseRationale(result.rationale);

  // Tool calls now come from the lab_tool_calls child table via IPC. The
  // legacy result.toolCallsExpected/Actual JSON-string fields are still on
  // the row during the dual-write phase but the canonical render uses the
  // child-table query so post-cutover data still displays correctly.
  // ADR: 2026-05-02-lab-tool-calls-child-table.
  const [toolCalls, setToolCalls] = useState<LabToolCall[] | null>(null);
  useEffect(() => {
    if (!resultId || !resultKind) {
      setToolCalls(null);
      return;
    }
    let cancelled = false;
    labGetToolCalls(resultId, resultKind)
      .then((rows) => {
        if (!cancelled) setToolCalls(rows);
      })
      .catch(silentCatch('labGetToolCalls'));
    return () => {
      cancelled = true;
    };
  }, [resultId, resultKind]);

  const expectedCalls = (toolCalls ?? []).filter((c) => c.variant === 'expected');
  const actualCalls = (toolCalls ?? []).filter((c) => c.variant === 'actual');

  return (
    <div className="border border-primary/15 rounded-modal bg-gradient-to-b from-secondary/20 to-background/30 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-secondary/30 border-b border-primary/10">
        <div className="flex items-center gap-2 min-w-0">
          <span className="typo-body font-medium text-foreground/90 truncate">{result.scenarioName}</span>
          {result.modelId && <span className="typo-caption px-1.5 py-0.5 rounded bg-primary/10 text-primary/70">{result.modelId}</span>}
        </div>
        <button onClick={onClose} aria-label="Close details" className="p-1 rounded hover:bg-secondary/50 text-foreground hover:text-foreground transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Verdict banner */}
        {structured?.verdict && (
          <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-card bg-gradient-to-r from-primary/8 to-accent/5 border border-primary/10">
            <Zap className="w-3.5 h-3.5 text-primary mt-0.5 flex-shrink-0" />
            <p className="typo-body text-foreground leading-relaxed">{structured.verdict}</p>
          </div>
        )}

        {/* Composite score header */}
        <div className="flex items-center gap-4 py-2">
          <div className={`typo-hero font-black tracking-tight ${scoreColor(composite)}`}>{composite ?? '—'}</div>
          <div>
            <span className={`typo-heading font-semibold ${scoreColor(composite)}`}>{scoreLabel(composite)}</span>
            <p className="typo-caption text-foreground">Composite Score (TA 40% + OQ 40% + PC 20%)</p>
          </div>
          <div className="flex-1" />
          <div className="text-right typo-caption text-foreground">
            <div>${result.costUsd.toFixed(4)}</div>
            <div>{(result.durationMs / 1000).toFixed(1)}s</div>
          </div>
        </div>

        {/* Per-metric score cards with inline rationale */}
        <div className="space-y-2">
          <ScoreCard
            label={t.agents.lab.tool_accuracy}
            icon={Target}
            score={ta}
            rationale={structured?.tool_accuracy ?? undefined}
            color="text-blue-400"
            borderColor="border-blue-500/10"
          />
          <ScoreCard
            label={t.agents.lab.output_quality}
            icon={FileText}
            score={oq}
            rationale={structured?.output_quality ?? undefined}
            color="text-emerald-400"
            borderColor="border-emerald-500/10"
          />
          <ScoreCard
            label={t.agents.lab.protocol_compliance}
            icon={Shield}
            score={pc}
            rationale={structured?.protocol ?? undefined}
            color="text-violet-400"
            borderColor="border-violet-500/10"
          />
        </div>

        {/* Plain rationale fallback (for older results without structured data) */}
        {plain && (
          <div className="space-y-1.5">
            <h5 className="flex items-center gap-1.5 typo-label font-semibold text-foreground uppercase tracking-wider">
              <MessageSquare className="w-3 h-3" />
              {t.agents.lab.evaluation_notes}
            </h5>
            <p className="typo-body text-foreground leading-relaxed bg-secondary/20 rounded-card px-3 py-2.5 border border-primary/5">
              {plain}
            </p>
          </div>
        )}

        {/* Suggestions */}
        {result.suggestions && (
          <div className="space-y-1.5">
            <h5 className="flex items-center gap-1.5 typo-label font-semibold text-amber-400/80 uppercase tracking-wider">
              <Lightbulb className="w-3 h-3" />
              {t.agents.lab.how_to_fix}
            </h5>
            <p className="typo-body text-foreground leading-relaxed bg-amber-500/5 rounded-card px-3 py-2.5 border border-amber-500/10">
              {result.suggestions}
            </p>
          </div>
        )}

        {/* User rating */}
        {onRate && (
          <div className="border-t border-primary/10 pt-3">
            <UserRating
              currentRating={rating}
              currentFeedback={ratingFeedback}
              onRate={onRate}
            />
          </div>
        )}

        {/* Output preview */}
        {result.outputPreview && (
          <details className="group">
            <summary className="flex items-center gap-1.5 typo-label font-semibold text-foreground uppercase tracking-wider cursor-pointer hover:text-muted-foreground/80">
              <ChevronDown className="w-3 h-3 transition-transform group-open:rotate-180" />
              {t.agents.lab.agent_output}
            </summary>
            <pre className="mt-2 typo-caption text-foreground bg-background/50 rounded-card p-3 border border-primary/5 max-h-[200px] overflow-y-auto whitespace-pre-wrap">
              {result.outputPreview}
            </pre>
          </details>
        )}

        {/* Event stream — only when result has a captured event log */}
        {resultId && resultKind && (
          <LabEventStream resultId={resultId} resultKind={resultKind} />
        )}

        {/* Tool calls */}
        {(expectedCalls.length > 0 || actualCalls.length > 0) && (
          <details className="group">
            <summary className="flex items-center gap-1.5 typo-label font-semibold text-foreground uppercase tracking-wider cursor-pointer hover:text-muted-foreground/80">
              <ChevronDown className="w-3 h-3 transition-transform group-open:rotate-180" />
              {t.agents.lab.tool_calls}
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <span className="typo-caption text-foreground block mb-1">{t.agents.lab.expected_label}</span>
                <pre className="typo-caption text-foreground bg-background/50 rounded-card p-2 border border-primary/5 max-h-[120px] overflow-y-auto whitespace-pre-wrap">
                  {expectedCalls.length > 0
                    ? expectedCalls.map((c) => c.toolName).join('\n')
                    : t.agents.lab.none_specified}
                </pre>
              </div>
              <div>
                <span className="typo-caption text-foreground block mb-1">{t.agents.lab.actual_label}</span>
                <pre className="typo-caption text-foreground bg-background/50 rounded-card p-2 border border-primary/5 max-h-[120px] overflow-y-auto whitespace-pre-wrap">
                  {actualCalls.length > 0
                    ? actualCalls.map((c) => c.toolName).join('\n')
                    : t.agents.lab.none_label}
                </pre>
              </div>
            </div>
          </details>
        )}

        {/* Error */}
        {result.errorMessage && (
          <div className="typo-body text-red-400 bg-red-500/10 rounded-card px-3 py-2 border border-red-500/20">
            {result.errorMessage}
          </div>
        )}
      </div>
    </div>
  );
}
