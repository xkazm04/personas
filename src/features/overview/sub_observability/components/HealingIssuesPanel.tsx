import { useState, useEffect, useCallback, useRef } from 'react';
import { Stethoscope, CheckCircle, CheckCircle2, AlertTriangle, X, List, GitBranch, FileWarning, ChevronDown, ChevronRight } from 'lucide-react';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';
import type { HealingTimelineEvent } from '@/lib/bindings/HealingTimelineEvent';
import type { HealingAuditEntry } from '@/lib/bindings/HealingAuditEntry';
import { listHealingAuditLog } from '@/api/overview/healing';
import { HealingIssueSummary } from './HealingIssueSummary';
import { IssuesList } from './IssuesList';
import { HealingTimeline } from './HealingTimeline';
import { ErrorRecoveryBanner } from '@/features/shared/components/feedback/ErrorRecoveryBanner';
import { useOverviewTranslation } from '@/features/overview/i18n/useOverviewTranslation';
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
  selectedPersonaId?: string | null;
}

const AUDIT_EVENT_LABELS: Record<string, string> = {
  knowledge_parse_error: 'Parse error',
  knowledge_persist_error: 'Persist error',
  ai_heal_section_missing: 'Section missing',
  ai_heal_unknown_target: 'Unknown target',
  ai_heal_unknown_fix_type: 'Unknown fix type',
  dedup_skipped: 'Duplicate skipped',
};

export function HealingIssuesPanel({
  healingIssues, healingRunning, handleRunAnalysis,
  resolveHealingIssue, setSelectedIssue,
  issueFilter, setIssueFilter, issueCounts, sortedFilteredIssues,
  analysisResult, setAnalysisResult, analysisError, setAnalysisError,
  viewMode, setViewMode, timelineEvents, timelineLoading,
  selectedPersonaId,
}: HealingIssuesPanelProps) {
  const handleTimelineSelectIssue = (issueId: string) => {
    const issue = healingIssues.find(i => i.id === issueId);
    if (issue) setSelectedIssue(issue);
  };

  const { t } = useOverviewTranslation();

  // Audit log state with 30-second cache to avoid duplicate API calls on toggle
  const [auditExpanded, setAuditExpanded] = useState(false);
  const [auditEntries, setAuditEntries] = useState<HealingAuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const auditCacheRef = useRef<{ personaId: string | null; ts: number }>({ personaId: null, ts: 0 });

  const fetchAudit = useCallback(async () => {
    const cacheKey = selectedPersonaId ?? null;
    const now = Date.now();
    if (auditCacheRef.current.personaId === cacheKey && now - auditCacheRef.current.ts < 30_000) {
      return;
    }
    setAuditLoading(true);
    setAuditError(null);
    try {
      const entries = await listHealingAuditLog(selectedPersonaId ?? undefined, 50);
      setAuditEntries(entries);
      auditCacheRef.current = { personaId: cacheKey, ts: Date.now() };
    } catch {
      setAuditError(t.errorRecovery.audit_fetch_failed);
    } finally {
      setAuditLoading(false);
    }
  }, [selectedPersonaId, t.errorRecovery.audit_fetch_failed]);

  useEffect(() => {
    if (auditExpanded) fetchAudit();
  }, [auditExpanded, fetchAudit]);

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
            <span className="px-2 py-0.5 typo-body font-black tracking-wide rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-elevation-1">
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
              title={"list_view"}
            >
              <List className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('timeline')}
              className={`p-1.5 transition-colors ${viewMode === 'timeline' ? 'bg-primary/10 text-foreground' : 'text-muted-foreground/60 hover:text-muted-foreground'}`}
              title={"timeline_view"}
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
            <span className="typo-body text-cyan-300">
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
            <span className="typo-body text-red-300">{analysisError}</span>
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
            <p className="typo-body text-muted-foreground mt-1">Run analysis to check for problems.</p>
          </div>
        </div>
      ) : (
        <IssuesList
          issues={sortedFilteredIssues}
          onSelectIssue={setSelectedIssue}
          onResolve={resolveHealingIssue}
        />
      )}

      {/* Healing Audit Log (silent failures) */}
      <div className="border-t border-primary/10">
        <button
          onClick={() => setAuditExpanded(!auditExpanded)}
          className="flex items-center gap-2 w-full px-4 py-2.5 text-left hover:bg-secondary/30 transition-colors"
        >
          {auditExpanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/70" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/70" />}
          <FileWarning className="w-3.5 h-3.5 text-amber-400/70" />
          <span className="typo-body typo-heading text-muted-foreground/90">Healing Audit Log</span>
          {auditEntries.length > 0 && auditExpanded && (
            <span className="px-1.5 py-0.5 typo-caption rounded-full bg-amber-500/10 text-amber-400/80 border border-amber-500/15">
              {auditEntries.length}
            </span>
          )}
        </button>

        {auditExpanded && (
          <div className="px-4 pb-3 max-h-64 overflow-y-auto">
            {auditError ? (
              <div className="py-2">
                <ErrorRecoveryBanner
                  severity="warning"
                  message={auditError}
                  cause={t.errorRecovery.audit_fetch_cause}
                  actionType="retry"
                  actionLabel={t.errorRecovery.action_retry}
                  onAction={() => { auditCacheRef.current = { personaId: null, ts: 0 }; fetchAudit(); }}
                  compact
                />
              </div>
            ) : auditLoading ? (
              <div className="flex items-center justify-center py-4">
                <div className="w-4 h-4 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
              </div>
            ) : auditEntries.length === 0 ? (
              <p className="typo-body text-muted-foreground/70 py-3 text-center">No silent failures recorded.</p>
            ) : (
              <div className="space-y-1">
                {auditEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-start gap-2 px-2.5 py-1.5 rounded-lg bg-secondary/30 border border-primary/5 typo-body"
                  >
                    <span className="shrink-0 px-1.5 py-0.5 typo-caption rounded bg-amber-500/10 text-amber-400/90 border border-amber-500/15 mt-0.5">
                      {AUDIT_EVENT_LABELS[entry.eventType] ?? entry.eventType}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-foreground/80 truncate">{entry.message}</p>
                      {entry.detail && (
                        <p className="text-muted-foreground/70 typo-caption truncate mt-0.5">{entry.detail}</p>
                      )}
                    </div>
                    <span className="shrink-0 typo-caption text-muted-foreground/50 mt-0.5">
                      {entry.subsystem}
                    </span>
                    <span className="shrink-0 typo-caption text-muted-foreground/40 mt-0.5">
                      {new Date(entry.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
