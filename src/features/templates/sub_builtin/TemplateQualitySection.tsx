import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';

interface StructuralCheck {
  name: string;
  passed: boolean;
  message: string;
}

function parseJsonSafe<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

export function TemplateQualitySection({ review }: { review: PersonaDesignReview }) {
  const structuralEval = parseJsonSafe<{ passed: boolean; score: number; checks: StructuralCheck[] } | null>(
    review.structural_evaluation,
    null
  );
  const semanticEval = parseJsonSafe<{
    passed: boolean;
    overallScore: number;
    dimensions: { name: string; score: number; feedback: string }[];
    llmReasoning: string;
  } | null>(review.semantic_evaluation, null);

  if (!structuralEval && !semanticEval) return null;

  return (
    <div>
      <h4 className="text-sm font-medium text-muted-foreground/90 uppercase tracking-wide mb-2">
        Quality Evaluation
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left: Structural checks */}
        <div>
          <h5 className="text-sm font-medium text-muted-foreground/80 mb-2">Structural Checks</h5>
          {structuralEval ? (
            <div className="space-y-1">
              {structuralEval.checks.map((check, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  {check.passed ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                  )}
                  <span className={check.passed ? 'text-foreground/90' : 'text-red-300/80'}>
                    <span className="font-medium">{check.name}</span>: {check.message}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground/80">No structural data</p>
          )}
        </div>

        {/* Right: Semantic dimensions */}
        <div>
          <h5 className="text-sm font-medium text-muted-foreground/80 mb-2">Semantic Dimensions</h5>
          {semanticEval ? (
            <div className="space-y-3">
              {semanticEval.dimensions.map((dim, i) => (
                <div key={i} className="text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-foreground/80 font-medium">{dim.name}</span>
                    <span
                      className={`text-sm font-mono font-semibold px-1.5 py-0.5 rounded ${
                        dim.score >= 80 ? 'text-emerald-400 bg-emerald-500/10' : dim.score >= 60 ? 'text-amber-400 bg-amber-500/10' : 'text-red-400 bg-red-500/10'
                      }`}
                    >
                      {dim.score}
                    </span>
                  </div>
                  <div className="space-y-0.5 pl-1">
                    {dim.feedback.split(/\\n|\n/).filter(Boolean).map((line, j) => {
                      const trimmed = line.trim();
                      const isPositive = trimmed.startsWith('+');
                      const isIssue = trimmed.startsWith('!');
                      const isBullet = trimmed.startsWith('-') || isPositive || isIssue;
                      const text = isBullet ? trimmed.slice(1).trim() : trimmed;
                      return (
                        <div key={j} className="flex items-start gap-1.5">
                          {isPositive ? (
                            <CheckCircle2 className="w-3 h-3 text-emerald-400 mt-0.5 flex-shrink-0" />
                          ) : isIssue ? (
                            <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 flex-shrink-0" />
                          ) : isBullet ? (
                            <span className="w-1 h-1 rounded-full bg-foreground/30 mt-1.5 flex-shrink-0" />
                          ) : null}
                          <span className={`${isIssue ? 'text-amber-300/90' : isPositive ? 'text-emerald-300/90' : 'text-foreground/80'}`}>
                            {text}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground/80">Semantic evaluation skipped</p>
          )}
        </div>
      </div>
    </div>
  );
}
