import { Target, FileText, Shield, Lightbulb, MessageSquare, X, ChevronDown } from 'lucide-react';
import { compositeScore, scoreColor } from '@/lib/eval/evalFramework';
import { UserRating } from './UserRating';

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
}

interface ScenarioDetailPanelProps {
  result: ScenarioResult;
  onClose: () => void;
  rating?: number;
  ratingFeedback?: string;
  onRate?: (rating: number, feedback?: string) => void;
}

function ScoreGauge({ label, icon: Icon, score, color }: { label: string; icon: typeof Target; score: number | null; color: string }) {
  const s = score ?? 0;
  return (
    <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-secondary/30 border border-primary/10 min-w-[100px]">
      <Icon className={`w-4 h-4 ${color}`} />
      <span className={`text-2xl font-bold ${scoreColor(s)}`}>{s}</span>
      <span className="text-xs text-muted-foreground/60">{label}</span>
    </div>
  );
}

export function ScenarioDetailPanel({ result, onClose, rating, ratingFeedback, onRate }: ScenarioDetailPanelProps) {
  const ta = result.toolAccuracyScore ?? 0;
  const oq = result.outputQualityScore ?? 0;
  const pc = result.protocolCompliance ?? 0;
  const composite = compositeScore(ta, oq, pc);

  return (
    <div className="border border-primary/15 rounded-xl bg-secondary/10 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-secondary/20 border-b border-primary/10">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-foreground/90 truncate">{result.scenarioName}</span>
          {result.modelId && <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary/70">{result.modelId}</span>}
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-secondary/50 text-muted-foreground/60 hover:text-foreground transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Score gauges */}
        <div className="flex items-center gap-3">
          <ScoreGauge label="Tool Accuracy" icon={Target} score={ta} color="text-blue-400" />
          <ScoreGauge label="Output Quality" icon={FileText} score={oq} color="text-emerald-400" />
          <ScoreGauge label="Protocol" icon={Shield} score={pc} color="text-violet-400" />
          <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-primary/5 border border-primary/15 min-w-[100px]">
            <span className="text-xs text-muted-foreground/60 uppercase tracking-wider">Composite</span>
            <span className={`text-3xl font-bold ${scoreColor(composite)}`}>{composite}</span>
            <span className="text-xs text-muted-foreground/50">${result.costUsd.toFixed(4)} / {(result.durationMs / 1000).toFixed(1)}s</span>
          </div>
        </div>

        {/* Rationale */}
        {result.rationale && (
          <div className="space-y-1.5">
            <h5 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
              <MessageSquare className="w-3 h-3" />
              Rationale
            </h5>
            <p className="text-sm text-foreground/80 leading-relaxed bg-secondary/20 rounded-lg px-3 py-2.5 border border-primary/5">
              {result.rationale}
            </p>
          </div>
        )}

        {/* Suggestions */}
        {result.suggestions && (
          <div className="space-y-1.5">
            <h5 className="flex items-center gap-1.5 text-xs font-semibold text-amber-400/80 uppercase tracking-wider">
              <Lightbulb className="w-3 h-3" />
              Improvement Suggestions
            </h5>
            <p className="text-sm text-foreground/80 leading-relaxed bg-amber-500/5 rounded-lg px-3 py-2.5 border border-amber-500/10">
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
          <div className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2 border border-red-500/15">
            {result.errorMessage}
          </div>
        )}
      </div>
    </div>
  );
}
