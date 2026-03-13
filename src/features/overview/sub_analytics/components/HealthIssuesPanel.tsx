import { memo, useMemo } from 'react';
import {
  Stethoscope, CheckCircle, CheckCircle2, X,
  AlertTriangle, Zap, RefreshCw,
} from 'lucide-react';
import { SEVERITY_COLORS, HEALING_CATEGORY_COLORS, badgeClass } from '@/lib/utils/formatters';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';

interface HealthIssuesPanelProps {
  healingIssues: PersonaHealingIssue[];
  healingRunning: boolean;
  sortedFilteredIssues: PersonaHealingIssue[];
  issueFilter: 'all' | 'open' | 'auto-fixed';
  setIssueFilter: (f: 'all' | 'open' | 'auto-fixed') => void;
  issueCounts: { all: number; open: number; autoFixed: number };
  analysisResult: { failures_analyzed: number; issues_created: number; auto_fixed: number } | null;
  analysisError: string | null;
  setAnalysisResult: (v: null) => void;
  setAnalysisError: (v: null) => void;
  handleRunAnalysis: () => void;
  resolveHealingIssue: (id: string) => void;
  onSelectIssue: (issue: PersonaHealingIssue) => void;
}

const CIRCUIT_BREAKER_RE = /circuit\s*breaker/i;

function computeAgeLabel(createdAt: string): string {
  const age = Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60));
  return age < 1 ? 'just now' : age < 24 ? `${age}h ago` : `${Math.floor(age / 24)}d ago`;
}

export const HealthIssuesPanel = memo(function HealthIssuesPanel({
  healingIssues, healingRunning, sortedFilteredIssues,
  issueFilter, setIssueFilter, issueCounts,
  analysisResult, analysisError, setAnalysisResult, setAnalysisError,
  handleRunAnalysis, resolveHealingIssue, onSelectIssue,
}: HealthIssuesPanelProps) {
  // Pre-compute age labels and circuit breaker flags for all visible issues
  const issueMetadata = useMemo(() => {
    const map = new Map<string, { ageLabel: string; isCircuitBreaker: boolean }>();
    for (const issue of sortedFilteredIssues) {
      map.set(issue.id, {
        ageLabel: computeAgeLabel(issue.created_at),
        isCircuitBreaker: CIRCUIT_BREAKER_RE.test(issue.title),
      });
    }
    return map;
  }, [sortedFilteredIssues]);
  return (
    <div className="rounded-xl border border-primary/10 bg-secondary/20 shadow-sm overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-4 py-4 border-b border-primary/5 bg-gradient-to-r from-secondary/40 to-transparent">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/20 shadow-inner flex items-center justify-center">
            <Stethoscope className="w-4 h-4 text-cyan-400" />
          </div>
          <h3 className="text-sm font-bold text-foreground/90 uppercase tracking-widest">Health Issues</h3>
          {healingIssues.length > 0 && (
            <span className="px-2 py-0.5 text-sm font-black tracking-wide rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-sm">
              {healingIssues.length}
            </span>
          )}
        </div>
        <button
          onClick={handleRunAnalysis}
          disabled={healingRunning}
          className="flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-xl bg-gradient-to-br from-cyan-500/15 to-transparent border border-cyan-500/20 text-cyan-300 hover:from-cyan-500/25 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
        >
          {healingRunning ? (
            <><div className="w-4 h-4 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />Analyzing...</>
          ) : (
            <><Stethoscope className="w-4 h-4" />Run Analysis</>
          )}
        </button>
      </div>

      {/* Analysis result */}
      {analysisResult && !healingRunning && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-cyan-500/10 border-b border-cyan-500/20">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-sm text-cyan-300">
              Analysis complete: {analysisResult.issues_created} issue{analysisResult.issues_created !== 1 ? 's' : ''} found
              {analysisResult.auto_fixed > 0 && ` (${analysisResult.auto_fixed} auto-fixed)`}
              , {analysisResult.failures_analyzed} execution{analysisResult.failures_analyzed !== 1 ? 's' : ''} scanned
            </span>
          </div>
          <button onClick={() => setAnalysisResult(null)} className="p-1 rounded hover:bg-cyan-500/20 text-cyan-400/50 hover:text-cyan-300 transition-colors">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {analysisError && !healingRunning && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-red-500/10 border-b border-red-500/20">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
            <span className="text-sm text-red-300">{analysisError}</span>
          </div>
          <button onClick={() => setAnalysisError(null)} className="p-1 rounded hover:bg-red-500/20 text-red-400/60 hover:text-red-300 transition-colors">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Filter chips */}
      {healingIssues.length > 0 && (
        <div className="px-4 py-2.5 border-b border-primary/10 flex items-center gap-1">
          {([
            { key: 'all' as const, label: 'All', count: issueCounts.all },
            { key: 'open' as const, label: 'Open', count: issueCounts.open },
            { key: 'auto-fixed' as const, label: 'Auto-fixed', count: issueCounts.autoFixed },
          ]).map((chip) => (
            <button
              key={chip.key}
              onClick={() => setIssueFilter(chip.key)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-sm font-medium transition-all ${
                issueFilter === chip.key
                  ? 'bg-background text-foreground shadow-sm border border-primary/20'
                  : 'text-muted-foreground/80 hover:text-muted-foreground'
              }`}
            >
              {chip.label}
              <span className={`px-1.5 py-0.5 text-sm font-bold rounded-full ${
                issueFilter === chip.key ? 'bg-primary/15 text-foreground/90' : 'bg-secondary/60 text-muted-foreground/80'
              }`}>{chip.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Issues list */}
      {healingIssues.length === 0 ? (
        <div className="flex items-center justify-center py-10">
          <div className="text-center flex flex-col items-center">
            <div className="w-14 h-14 rounded-xl bg-emerald-500/10 border border-emerald-500/20 shadow-inner flex items-center justify-center mb-4 opacity-70">
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
            </div>
            <p className="text-sm font-medium text-foreground/80">No open issues</p>
            <p className="text-sm text-muted-foreground mt-1">Run analysis to check for problems.</p>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-primary/5 bg-gradient-to-b from-transparent to-black/[0.02]">
          {sortedFilteredIssues.map((issue: PersonaHealingIssue) => {
            const sevBadge = SEVERITY_COLORS[issue.severity] ?? SEVERITY_COLORS.medium!;
            const meta = issueMetadata.get(issue.id);
            const ageLabel = meta?.ageLabel ?? '';
            const isAutoFixed = issue.auto_fixed;
            const isCircuitBreaker = meta?.isCircuitBreaker ?? false;

            return (
              <div key={issue.id} className={`flex items-center gap-4 px-4 py-4 hover:bg-white/[0.03] transition-colors group cursor-pointer ${isAutoFixed ? 'opacity-70' : ''} ${isCircuitBreaker ? 'bg-red-500/5' : ''}`}>
                {isCircuitBreaker ? (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm font-mono uppercase rounded-lg border bg-red-500/15 text-red-400 border-red-500/25">
                    <Zap className="w-3 h-3" />breaker
                  </span>
                ) : isAutoFixed ? (
                  <span className="inline-flex px-1.5 py-0.5 text-sm font-mono uppercase rounded-lg border bg-emerald-500/15 text-emerald-400 border-emerald-500/20">fixed</span>
                ) : (
                  <span className={`inline-flex px-1.5 py-0.5 text-sm font-mono uppercase rounded-lg ${badgeClass(sevBadge)}`}>{issue.severity}</span>
                )}
                {isAutoFixed && issue.execution_id && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm font-mono rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" title="Auto-healed via retry">
                    <RefreshCw className="w-2.5 h-2.5" />retry
                  </span>
                )}
                <button
                  onClick={() => onSelectIssue(issue)}
                  className={`flex-1 text-left text-sm transition-colors line-clamp-2 ${isCircuitBreaker ? 'text-red-400/90 hover:text-red-300 font-medium' : isAutoFixed ? 'text-foreground/90 line-through decoration-emerald-500/30' : 'text-foreground/80 hover:text-foreground'}`}
                >
                  {issue.title}
                </button>
                <span className={`text-sm font-mono min-w-[90px] text-right ${HEALING_CATEGORY_COLORS[issue.category]?.text || 'text-muted-foreground/80'}`}>
                  {issue.category}
                </span>
                <span className="text-sm text-muted-foreground/80 w-16 text-right">{ageLabel}</span>
                {!isAutoFixed && (
                  <button
                    onClick={() => resolveHealingIssue(issue.id)}
                    className="px-2 py-1 text-sm font-medium text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-colors"
                  >
                    Resolve
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
