import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Info,
  RefreshCw,
  ChevronRight,
  Clock,
} from 'lucide-react';
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import { SEVERITY_STYLES } from '@/lib/utils/designTokens';
import { isTimestampStale } from '@/stores/slices/agents/healthCheckSlice';
import { STATUS_CONFIG } from './statusConfig';
import { ScoreRing } from './HealthScoreDisplay';
import type { DryRunIssue, PersonaHealthCheck } from './types';
import ContentLoader from '@/features/shared/components/progress/ContentLoader';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { useTranslation } from '@/i18n/useTranslation';
import { formatTimestamp } from '@/lib/utils/formatters';
import { Button } from '@/features/shared/components/buttons';
import { BaseModal } from '@/lib/ui/BaseModal';
import type { Translations } from '@/i18n/en';

// -- Persona row in digest --------------------------------------------

function PersonaDigestRow({
  check,
  onOpenIssues,
}: {
  check: PersonaHealthCheck;
  onOpenIssues: (check: PersonaHealthCheck) => void;
}) {
  const { t } = useTranslation();
  const errors = check.result.issues.filter((i: DryRunIssue) => i.severity === 'error').length;
  const warnings = check.result.issues.filter((i: DryRunIssue) => i.severity === 'warning').length;
  const infos = check.result.issues.filter((i: DryRunIssue) => i.severity === 'info').length;
  const totalIssues = errors + warnings + infos;

  const severityClass = STATUS_CONFIG[check.result.status].rowBorderClass;
  const nameClass =
    check.result.status === 'blocked'
      ? 'typo-body font-semibold text-foreground truncate'
      : 'typo-body font-medium text-foreground truncate';

  return (
    <button
      type="button"
      onClick={() => onOpenIssues(check)}
      className={`w-full flex items-center gap-2 px-3 py-2 rounded-modal hover:bg-primary/5 transition-colors text-left group ${severityClass}`}
    >
      {/* Persona icon — shared component handles emoji / catalog icon / Bot fallback */}
      <PersonaIcon
        icon={check.personaIcon ?? null}
        color={check.personaColor ?? null}
        display="framed"
        frameSize="sm"
      />

      {/* Name */}
      <p className={`${nameClass} flex-1`}>{check.personaName}</p>

      {/* Inline issue counts (right-aligned, single row) */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {totalIssues === 0 ? (
          <span className="typo-caption text-emerald-400/70 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> {t.agents.health_score.healthy}
          </span>
        ) : (
          <>
            {errors > 0 && (
              <span className="typo-caption text-red-400 flex items-center gap-0.5">
                <XCircle className="w-3 h-3" /> {errors}
              </span>
            )}
            {warnings > 0 && (
              <span className="typo-caption text-amber-400 flex items-center gap-0.5">
                <AlertTriangle className="w-3 h-3" /> {warnings}
              </span>
            )}
            {infos > 0 && (
              <span className="typo-caption text-blue-400 flex items-center gap-0.5">
                <Info className="w-3 h-3" /> {infos}
              </span>
            )}
          </>
        )}
      </div>

      {/* Status indicator */}
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_CONFIG[check.result.status].dotClass}`} />

      <ChevronRight className="w-4 h-4 text-foreground group-hover:text-muted-foreground/60 transition-colors" />
    </button>
  );
}

// -- Issue-description modal -------------------------------------------

function HealthIssueModal({
  check,
  onClose,
  onNavigate,
  t,
  tx,
}: {
  check: PersonaHealthCheck | null;
  onClose: () => void;
  onNavigate: (personaId: string) => void;
  t: Translations;
  tx: (template: string, params: Record<string, string | number>) => string;
}) {
  const open = !!check;
  return (
    <BaseModal
      isOpen={open}
      onClose={onClose}
      titleId="health-issue-modal-title"
      maxWidthClass="max-w-lg"
      panelClassName="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 overflow-hidden"
      portal
    >
      {check && (
        <div className="p-4 space-y-4">
          <div className="flex items-start gap-3">
            <PersonaIcon
              icon={check.personaIcon ?? null}
              color={check.personaColor ?? null}
              display="framed"
              frameSize="md"
            />
            <div className="min-w-0 flex-1">
              <h3 id="health-issue-modal-title" className="typo-heading font-semibold text-foreground/90 truncate">
                {tx(t.agents.health_digest.issue_modal_title, { name: check.personaName })}
              </h3>
              <div className="flex items-center gap-1.5 mt-1">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_CONFIG[check.result.status].dotClass}`} />
                <p className="typo-caption text-foreground">
                  {check.result.status === 'blocked'
                    ? t.agents.health_digest.critical_issues
                    : check.result.status === 'partial'
                      ? t.agents.health_digest.some_attention
                      : t.agents.health_digest.all_healthy}
                </p>
              </div>
            </div>
          </div>

          <div className="max-h-[50vh] overflow-y-auto space-y-2">
            {check.result.issues.length === 0 ? (
              <p className="typo-body text-foreground">
                {t.agents.health_digest.issue_modal_no_issues}
              </p>
            ) : (
              check.result.issues.map((issue: DryRunIssue) => {
                const SeverityIcon =
                  issue.severity === 'error' ? XCircle :
                  issue.severity === 'warning' ? AlertTriangle :
                  Info;
                const tone = SEVERITY_STYLES[issue.severity];
                return (
                  <div
                    key={issue.id}
                    className={`flex items-start gap-2 px-3 py-2 rounded-card border ${tone.bg} ${tone.text}`}
                  >
                    <SeverityIcon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <p className="typo-body text-foreground/90">{issue.description}</p>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button type="button" onClick={onClose} variant="secondary" size="md">
              {t.agents.health_digest.issue_modal_close}
            </Button>
            <Button type="button" onClick={() => onNavigate(check.personaId)} variant="primary" size="md">
              {t.agents.health_digest.issue_modal_open_detail}
            </Button>
          </div>
        </div>
      )}
    </BaseModal>
  );
}

// -- Main digest panel ------------------------------------------------

export function HealthDigestPanel() {
  const { t, tx } = useTranslation();
  // State reads batched through useShallow (multi-field pattern); action
  // setters stay as single-field selectors since their references are
  // stable across renders.
  const { digest, running, lastDigestAt } = useAgentStore(useShallow((s) => ({
    digest: s.healthDigest,
    running: s.healthDigestRunning,
    lastDigestAt: s.lastDigestAt,
  })));
  const runFullHealthDigest = useAgentStore((s) => s.runFullHealthDigest);
  const selectPersona = useAgentStore((s) => s.selectPersona);
  const setEditorTab = useSystemStore((s) => s.setEditorTab);
  const isStale = useMemo(() => isTimestampStale(lastDigestAt), [lastDigestAt]);

  // Sort + group personas once per digest (or locale change). Previously this
  // ran on every render — including unrelated store updates like the running
  // flag flipping or lastDigestAt ticking — which gets expensive once a user
  // has 50+ personas.
  const groups = useMemo<
    Array<{ key: 'blocked' | 'attention' | 'healthy'; label: string; rows: PersonaHealthCheck[] }>
  >(() => {
    if (!digest) return [];
    const sorted = [...digest.personas].sort((a, b) => {
      const aIssues = a.result.issues.length;
      const bIssues = b.result.issues.length;
      if (a.result.status === 'blocked' && b.result.status !== 'blocked') return -1;
      if (b.result.status === 'blocked' && a.result.status !== 'blocked') return 1;
      return bIssues - aIssues;
    });
    const allGroups = [
      { key: 'blocked' as const, label: t.agents.health_digest.group_blocked, rows: sorted.filter((c) => c.result.status === 'blocked') },
      { key: 'attention' as const, label: t.agents.health_digest.group_attention, rows: sorted.filter((c) => c.result.status === 'partial') },
      { key: 'healthy' as const, label: t.agents.health_digest.group_healthy, rows: sorted.filter((c) => c.result.status === 'ready') },
    ];
    return allGroups.filter((g) => g.rows.length > 0);
  }, [digest, t]);

  const [issueModalCheck, setIssueModalCheck] = useState<PersonaHealthCheck | null>(null);

  const handleNavigate = (personaId: string) => {
    setIssueModalCheck(null);
    selectPersona(personaId);
    // Land on the design tab — the editor's HealthBadge sits in its tab bar
    // and the design surface is where the per-persona health check actually
    // runs. Settings shows account / API keys / quality gates, not health.
    setEditorTab('design');
  };

  const handleRunDigest = async () => {
    await runFullHealthDigest();
  };

  // Loading state
  if (running) {
    return (
      <div className="rounded-modal border border-primary/20 bg-secondary/40 p-6">
        <ContentLoader variant="panel" label={t.agents.health_digest.generating} hint="health-digest" />
      </div>
    );
  }

  // No digest yet -- prompt to run
  if (!digest) {
    return (
      <div className="rounded-modal border border-primary/20 bg-secondary/40 p-6">
        <div className="flex items-center gap-3 mb-4">
          <Activity className="w-5 h-5 text-primary/60" aria-hidden="true" />
          <h3 className="typo-heading font-semibold text-foreground">{t.agents.health_digest.title}</h3>
        </div>
        <p className="typo-body text-foreground mb-4">
          {t.agents.health_digest.description}
        </p>
        <Button
          type="button"
          onClick={handleRunDigest}
          variant="primary"
          size="md"
          icon={<Activity className="w-4 h-4" aria-hidden="true" />}
        >
          {t.agents.health_digest.run_digest}
        </Button>
      </div>
    );
  }

  // Show results
  const { totalScore, totalIssues, errorCount, warningCount, infoCount, personas } = digest;

  return (
    <div className="rounded-modal border border-primary/20 bg-secondary/40 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-primary/10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="w-5 h-5 text-primary/60" aria-hidden="true" />
          <h3 className="typo-heading font-semibold text-foreground">{t.agents.health_digest.title}</h3>
        </div>
        <Button
          type="button"
          onClick={handleRunDigest}
          variant="secondary"
          size="sm"
          icon={<RefreshCw className="w-3 h-3" />}
        >
          {t.agents.health_check.rerun}
        </Button>
      </div>

      {/* Staleness warning */}
      {isStale && (
        <div className="px-4 py-2 flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/5">
          <Clock className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
          <p className="typo-caption text-amber-400/90 flex-1">
            {t.agents.health_digest.stale_warning}
          </p>
          <button
            type="button"
            onClick={handleRunDigest}
            className="typo-caption font-medium text-amber-400 hover:text-amber-300 transition-colors underline underline-offset-2"
          >
            {t.common.refresh}
          </button>
        </div>
      )}

      {/* Summary bar — compact so the meta row + severity badges always fit
          on one line in a narrow right-rail card. Wraps gracefully on
          extreme widths instead of clipping. */}
      <div className="px-4 py-3 flex items-center gap-3 border-b border-primary/10 bg-primary/[0.02]">
        <ScoreRing score={totalScore} size="sm" />
        <div className="flex-1 min-w-0">
          <p className="typo-body font-medium text-foreground truncate">
            {totalScore.grade === 'healthy' ? t.agents.health_digest.all_healthy :
             totalScore.grade === 'degraded' ? t.agents.health_digest.some_attention :
             t.agents.health_digest.critical_issues}
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 typo-caption text-foreground">
            <span>
              {tx(personas.length === 1 ? t.agents.health_digest.agents_checked_one : t.agents.health_digest.agents_checked_other, { count: personas.length })}
            </span>
            {totalIssues > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {tx(totalIssues === 1 ? t.agents.health_digest.issues_one : t.agents.health_digest.issues_other, { count: totalIssues })}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Issue breakdown badges */}
        {totalIssues > 0 && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {errorCount > 0 && (
              <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-card typo-caption font-medium ${SEVERITY_STYLES.error.bg} ${SEVERITY_STYLES.error.text}`}>
                <XCircle className="w-3 h-3" /> {errorCount}
              </span>
            )}
            {warningCount > 0 && (
              <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-card typo-caption font-medium ${SEVERITY_STYLES.warning.bg} ${SEVERITY_STYLES.warning.text}`}>
                <AlertTriangle className="w-3 h-3" /> {warningCount}
              </span>
            )}
            {infoCount > 0 && (
              <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-card typo-caption font-medium ${SEVERITY_STYLES.info.bg} ${SEVERITY_STYLES.info.text}`}>
                <Info className="w-3 h-3" /> {infoCount}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Per-persona list — grouped by severity */}
      <div>
        {groups.map((group, groupIdx) => (
          <div
            key={group.key}
            className={groupIdx > 0 ? 'border-t border-border/40' : undefined}
          >
            <div className="px-4 pt-3 pb-1">
              <span className="typo-caption uppercase tracking-wide text-foreground font-medium">
                {group.label}
              </span>
            </div>
            <div className="divide-y divide-primary/5">
              {group.rows.map((check) => (
                <PersonaDigestRow key={check.personaId} check={check} onOpenIssues={setIssueModalCheck} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Timestamp */}
      <div className="px-4 py-2 border-t border-primary/10 bg-primary/[0.02]">
        <p className="typo-caption text-foreground">
          {tx(t.agents.health_digest.last_run, { time: formatTimestamp(digest.generatedAt) })}
        </p>
      </div>

      <HealthIssueModal
        check={issueModalCheck}
        onClose={() => setIssueModalCheck(null)}
        onNavigate={handleNavigate}
        t={t}
        tx={tx}
      />
    </div>
  );
}
