import { Stethoscope, CheckCircle, CheckCircle2, AlertTriangle, X } from 'lucide-react';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';
import { HealingIssueSummary } from './HealingIssueSummary';
import { IssuesList } from './IssuesList';

interface HealingIssuesPanelProps {
  healingIssues: PersonaHealingIssue[];
  healingRunning: boolean;
  handleRunAnalysis: () => void;
  resolveHealingIssue: (id: string) => void;
  setSelectedIssue: (issue: PersonaHealingIssue) => void;
  issueFilter: 'all' | 'open' | 'auto-fixed';
  setIssueFilter: (f: 'all' | 'open' | 'auto-fixed') => void;
  issueCounts: { all: number; open: number; autoFixed: number };
  sortedFilteredIssues: PersonaHealingIssue[];
  analysisResult: { failures_analyzed: number; issues_created: number; auto_fixed: number } | null;
  setAnalysisResult: (r: null) => void;
  analysisError: string | null;
  setAnalysisError: (e: null) => void;
}

export function HealingIssuesPanel({
  healingIssues, healingRunning, handleRunAnalysis,
  resolveHealingIssue, setSelectedIssue,
  issueFilter, setIssueFilter, issueCounts, sortedFilteredIssues,
  analysisResult, setAnalysisResult, analysisError, setAnalysisError,
}: HealingIssuesPanelProps) {
  return (
    <div className="rounded-xl border border-primary/10 bg-secondary/20 shadow-sm overflow-hidden flex flex-col">
      {/* Header */}
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
            <>
              <div className="w-4 h-4 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
              Analyzing...
            </>
          ) : (
            <>
              <Stethoscope className="w-4 h-4" />
              Run Analysis
            </>
          )}
        </button>
      </div>

      {/* Analysis Result Summary */}
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
          <button onClick={() => setAnalysisError(null)} className="p-1 rounded hover:bg-red-500/20 text-red-400/50 hover:text-red-300 transition-colors">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Issues Summary */}
      {healingIssues.length > 0 && <HealingIssueSummary issues={healingIssues} />}

      {/* Filter Chips */}
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
                issueFilter === chip.key
                  ? 'bg-primary/15 text-foreground/90'
                  : 'bg-secondary/60 text-muted-foreground/80'
              }`}>
                {chip.count}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Issues List */}
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
        <IssuesList
          issues={sortedFilteredIssues}
          onSelectIssue={setSelectedIssue}
          onResolve={resolveHealingIssue}
        />
      )}
    </div>
  );
}
