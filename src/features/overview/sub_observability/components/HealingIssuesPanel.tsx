import { Stethoscope, CheckCircle, CheckCircle2, AlertTriangle, X, List, GitBranch } from 'lucide-react';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';
import type { HealingTimelineEvent } from '@/lib/bindings/HealingTimelineEvent';
import { HealingIssueSummary } from './HealingIssueSummary';
import { IssuesList } from './IssuesList';
import { HealingTimeline } from './HealingTimeline';
import type { HealingViewMode as ViewMode } from '@/lib/constants/uiModes';

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
  // Timeline props
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  timelineEvents: HealingTimelineEvent[];
  timelineLoading: boolean;
}

export function HealingIssuesPanel({
  healingIssues, healingRunning, handleRunAnalysis,
  resolveHealingIssue, setSelectedIssue,
  issueFilter, setIssueFilter, issueCounts, sortedFilteredIssues,
  analysisResult, setAnalysisResult, analysisError, setAnalysisError,
  viewMode, setViewMode, timelineEvents, timelineLoading,
}: HealingIssuesPanelProps) {
  const handleTimelineSelectIssue = (issueId: string) => {
    const issue = healingIssues.find(i => i.id === issueId);
    if (issue) setSelectedIssue(issue);
  };
  return (
    <div className="rounded-xl border border-primary/10 bg-secondary/20 shadow-elevation-1 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-primary/5 bg-gradient-to-r from-secondary/40 to-transparent">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/20 shadow-inner flex items-center justify-center">
            <Stethoscope className="w-4 h-4 text-cyan-400" />
          </div>
          <h3 className="typo-heading text-foreground/90 uppercase tracking-widest">Health Issues</h3>
          {healingIssues.length > 0 && (
            <span className="px-2 py-0.5 text-sm font-black tracking-wide rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-elevation-1">
              {healingIssues.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center rounded-lg border border-primary/15 overflow-hidden">
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 transition-colors ${viewMode === 'list' ? 'bg-primary/10 text-foreground' : 'text-muted-foreground/60 hover:text-muted-foreground'}`}
              title="List view"
            >
              <List className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('timeline')}
              className={`p-1.5 transition-colors ${viewMode === 'timeline' ? 'bg-primary/10 text-foreground' : 'text-muted-foreground/60 hover:text-muted-foreground'}`}
              title="Timeline view"
            >
              <GitBranch className="w-3.5 h-3.5" />
            </button>
          </div>
          <button
            onClick={handleRunAnalysis}
            disabled={healingRunning}
            aria-label={healingRunning ? 'Analysis in progress' : 'Run healing analysis'}
            className="flex items-center gap-2 px-4 py-2 typo-heading rounded-xl bg-gradient-to-br from-cyan-500/15 to-transparent border border-cyan-500/20 text-cyan-300 hover:from-cyan-500/25 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-elevation-1 focus-visible:ring-2 focus-visible:ring-cyan-500/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
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
        <div className="px-4 py-2.5 border-b border-primary/10 flex items-center gap-1" role="tablist">
          {([
            { key: 'all' as const, label: 'All', count: issueCounts.all },
            { key: 'open' as const, label: 'Open', count: issueCounts.open },
            { key: 'auto-fixed' as const, label: 'Auto-fixed', count: issueCounts.autoFixed },
          ]).map((chip) => (
            <button
              key={chip.key}
              role="tab"
              aria-selected={issueFilter === chip.key}
              onClick={() => setIssueFilter(chip.key)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-xl typo-heading transition-all focus-visible:ring-2 focus-visible:ring-cyan-500/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
                issueFilter === chip.key
                  ? 'bg-background text-foreground shadow-elevation-1 border border-primary/20'
                  : 'text-muted-foreground/80 hover:text-muted-foreground'
              }`}
            >
              {chip.label}
              <span className={`px-1.5 py-0.5 typo-heading rounded-full ${
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

      {/* Content: List or Timeline */}
      {viewMode === 'timeline' ? (
        <HealingTimeline
          events={timelineEvents}
          loading={timelineLoading}
          onSelectIssue={handleTimelineSelectIssue}
        />
      ) : healingIssues.length === 0 ? (
        <div className="flex items-center justify-center py-10">
          <div className="text-center flex flex-col items-center">
            <div className="w-14 h-14 rounded-xl bg-emerald-500/10 border border-emerald-500/20 shadow-inner flex items-center justify-center mb-4 opacity-70">
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
            </div>
            <p className="typo-heading text-foreground/80">No open issues</p>
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
