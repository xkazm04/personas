import { Target, FileText, Shield, Lightbulb, MessageSquare, X, ChevronDown, Zap, AlertTriangle } from 'lucide-react';
import { compositeScore, scoreColor } from '@/lib/eval/evalFramework';
import { UserRating } from './UserRating';
import { useLabTranslation } from '../../i18n/useLabTranslation';

interface ScenarioResult {
  scenarioName: string;
  modelId?: string;
  status: string;
  toolAccuracyScore: number | null;
  outputQualityScore: number | null;
  protocolCompliance: number | null;
  outputPreview: string | null;
  toolCallsExpected: string | null;
  toolCallsActual: string | null;
  costUsd: number;
  durationMs: number;
  errorMessage: string | null;
  rationale: string | null;
  suggestions: string | null;
  evalMethod?: string | null;
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

function scoreLabel(score: number): string {
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
  const s = score ?? 0;
  return (
    <div className={`rounded-xl border ${borderColor} bg-background/30 overflow-hidden`}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <Icon className={`w-4 h-4 ${color} flex-shrink-0`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-foreground/70">{label}</span>
            <span className={`text-xs font-semibold ${scoreColor(s)}`}>{scoreLabel(s)}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-primary/5 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${s >= 80 ? 'bg-emerald-500/70' : s >= 50 ? 'bg-amber-500/70' : 'bg-red-500/60'}`}
              style={{ width: `${Math.max(s, 2)}%` }}
            />
          </div>
        </div>
        <span className={`text-lg font-bold tabular-nums ${scoreColor(s)}`}>{s}</span>
      </div>
      {rationale && (
        <div className="px-3 pb-2.5 -mt-0.5">
          <p className="text-xs text-foreground/60 leading-relaxed">{rationale}</p>
        </div>
      )}
    </div>
  );
}

export function ScenarioDetailPanel({ result, onClose, rating, ratingFeedback, onRate }: ScenarioDetailPanelProps) {
  const ta = result.toolAccuracyScore ?? 0;
  const oq = result.outputQualityScore ?? 0;
  const pc = result.protocolCompliance ?? 0;
  const composite = compositeScore(ta, oq, pc);
  const { t } = useLabTranslation();

  const { structured, plain } = parseRationale(result.rationale);
  const isDegraded = result.evalMethod === 'heuristic_fallback' || result.evalMethod === 'timeout';

  return (
    <div className="border border-primary/15 rounded-xl bg-gradient-to-b from-secondary/20 to-background/30 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-secondary/30 border-b border-primary/10">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-foreground/90 truncate">{result.scenarioName}</span>
          {result.modelId && <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary/70">{result.modelId}</span>}
        </div>
        <button onClick={onClose} aria-label="Close details" className="p-1 rounded hover:bg-secondary/50 text-muted-foreground/60 hover:text-foreground transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Degraded evaluation warning */}
        {isDegraded && (
          <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-300">
                {result.evalMethod === 'timeout' ? t.evalMethod.timeoutTitle : t.evalMethod.fallbackTitle}
              </p>
              <p className="text-xs text-foreground/70 mt-0.5">
                {result.evalMethod === 'timeout' ? t.evalMethod.timeoutDesc : t.evalMethod.fallbackDesc}
              </p>
            </div>
          </div>
        )}

        {/* Verdict banner */}
        {structured?.verdict && (
          <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-lg bg-gradient-to-r from-primary/8 to-accent/5 border border-primary/10">
            <Zap className="w-3.5 h-3.5 text-primary mt-0.5 flex-shrink-0" />
            <p className="text-sm text-foreground/80 leading-relaxed">{structured.verdict}</p>
          </div>
        )}

        {/* Composite score header */}
        <div className="flex items-center gap-4 py-2">
          <div className={`text-4xl font-black tracking-tight ${scoreColor(composite)}`}>{composite}</div>
          <div>
            <span className={`text-sm font-semibold ${scoreColor(composite)}`}>{scoreLabel(composite)}</span>
            <p className="text-xs text-muted-foreground/50">Composite Score (TA 40% + OQ 40% + PC 20%)</p>
          </div>
          <div className="flex-1" />
          <div className="text-right text-xs text-muted-foreground/40">
            <div>${result.costUsd.toFixed(4)}</div>
            <div>{(result.durationMs / 1000).toFixed(1)}s</div>
          </div>
        </div>

        {/* Per-metric score cards with inline rationale */}
        <div className="space-y-2">
          <ScoreCard
            label="Tool Accuracy"
            icon={Target}
            score={ta}
            rationale={structured?.tool_accuracy ?? undefined}
            color="text-blue-400"
            borderColor="border-blue-500/10"
          />
          <ScoreCard
            label="Output Quality"
            icon={FileText}
            score={oq}
            rationale={structured?.output_quality ?? undefined}
            color="text-emerald-400"
            borderColor="border-emerald-500/10"
          />
          <ScoreCard
            label="Protocol Compliance"
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
            <h5 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
              <MessageSquare className="w-3 h-3" />
              Evaluation Notes
            </h5>
            <p className="text-sm text-foreground/70 leading-relaxed bg-secondary/20 rounded-lg px-3 py-2.5 border border-primary/5">
              {plain}
            </p>
          </div>
        )}

        {/* Suggestions */}
        {result.suggestions && (
          <div className="space-y-1.5">
            <h5 className="flex items-center gap-1.5 text-xs font-semibold text-amber-400/80 uppercase tracking-wider">
              <Lightbulb className="w-3 h-3" />
              How to Fix This
            </h5>
            <p className="text-sm text-foreground/70 leading-relaxed bg-amber-500/5 rounded-lg px-3 py-2.5 border border-amber-500/10">
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
            <summary className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider cursor-pointer hover:text-muted-foreground/80">
              <ChevronDown className="w-3 h-3 transition-transform group-open:rotate-180" />
              Agent Output
            </summary>
            <pre className="mt-2 text-xs text-muted-foreground/80 bg-background/50 rounded-lg p-3 border border-primary/5 max-h-[200px] overflow-y-auto whitespace-pre-wrap">
              {result.outputPreview}
            </pre>
          </details>
        )}

        {/* Tool calls */}
        {(result.toolCallsExpected || result.toolCallsActual) && (
          <details className="group">
            <summary className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider cursor-pointer hover:text-muted-foreground/80">
              <ChevronDown className="w-3 h-3 transition-transform group-open:rotate-180" />
              Tool Calls
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <span className="text-xs text-muted-foreground/50 block mb-1">Expected</span>
                <pre className="text-xs text-muted-foreground/80 bg-background/50 rounded-lg p-2 border border-primary/5 max-h-[120px] overflow-y-auto whitespace-pre-wrap">
                  {result.toolCallsExpected ?? 'None specified'}
                </pre>
              </div>
              <div>
                <span className="text-xs text-muted-foreground/50 block mb-1">Actual</span>
                <pre className="text-xs text-muted-foreground/80 bg-background/50 rounded-lg p-2 border border-primary/5 max-h-[120px] overflow-y-auto whitespace-pre-wrap">
                  {result.toolCallsActual ?? 'None'}
                </pre>
              </div>
            </div>
          </details>
        )}

        {/* Error */}
        {result.errorMessage && (
          <div className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2 border border-red-500/20">
            {result.errorMessage}
          </div>
        )}
      </div>
    </div>
  );
}
