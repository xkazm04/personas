/**
 * ContextMapHealth — the human surface for the context audit.
 *
 * `dev_tools_audit_contexts` has existed, tested and registered, since the
 * integrity checks were written, and nothing ever called it: no UI, no scan
 * hook, no CI step. The map lost its entire topology layer in one transaction
 * and the detector that would have named it on day one sat one call away. This
 * is that call, on the page where the map lives.
 *
 * Advisory only — it reports, it never blocks a scan or a save. The one action
 * it offers (the cross-ref repair) is dry-run first and confirmed before it
 * writes, because context history is not versioned.
 *
 * i18n note (CONTRACT.md I1): Rust hands over `kind` CODES and numbers. The
 * `message` sentence the audit also carries is Layer-1 operator text for the
 * scan log and the loopback bridge — it is deliberately NOT rendered here.
 */
import { useState } from 'react';
import { Stethoscope, Wrench } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { auditContexts, repairCrossRefs } from '@/api/devTools/devTools';
import type { ContextAuditReport, CrossRefRepairPlan } from '@/api/devTools/devTools';
import { useToastStore } from '@/stores/toastStore';
import type { TDevTools } from './contextLedgerShared';

const SEVERITY_VARIANT: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = {
  error: 'error',
  warn: 'warning',
  info: 'neutral',
};

/**
 * Resolve an audit `kind` code to prose. Written as an exhaustive switch rather
 * than a computed `t[...]` lookup so every key is type-checked (CONTRACT.md I4)
 * — a renamed key fails the build instead of silently rendering a raw code.
 * An unknown kind falls back to the code itself: better a machine token on
 * screen than a blank row that hides a finding.
 */
function kindLabel(t: TDevTools, kind: string): string {
  switch (kind) {
    case 'unresolved_cross_ref': return t.ctx_audit_kind_unresolved_cross_ref;
    case 'dangling_file_path': return t.ctx_audit_kind_dangling_file_path;
    case 'file_overlap': return t.ctx_audit_kind_file_overlap;
    case 'stale_context': return t.ctx_audit_kind_stale_context;
    case 'empty_context': return t.ctx_audit_kind_empty_context;
    case 'oversized_context': return t.ctx_audit_kind_oversized_context;
    case 'undersized_context': return t.ctx_audit_kind_undersized_context;
    case 'uncategorized_context': return t.ctx_audit_kind_uncategorized_context;
    case 'invalid_category': return t.ctx_audit_kind_invalid_category;
    case 'empty_group': return t.ctx_audit_kind_empty_group;
    case 'group_too_many_contexts': return t.ctx_audit_kind_group_too_many_contexts;
    case 'group_too_few_contexts': return t.ctx_audit_kind_group_too_few_contexts;
    case 'group_missing_domain': return t.ctx_audit_kind_group_missing_domain;
    case 'invalid_domain': return t.ctx_audit_kind_invalid_domain;
    case 'file_overlap_truncated':
    case 'dangling_file_path_truncated':
    case 'unresolved_cross_ref_truncated':
      return t.ctx_audit_more_not_listed;
    default: return kind;
  }
}

function severityLabel(t: TDevTools, severity: string): string {
  if (severity === 'error') return t.ctx_audit_sev_error;
  if (severity === 'warn') return t.ctx_audit_sev_warn;
  return t.ctx_audit_sev_info;
}

export function ContextMapHealth({ projectId }: { projectId: string }) {
  const { t: tRoot, tx } = useTranslation();
  const t = tRoot.plugins.dev_tools;
  const addToast = useToastStore((s) => s.addToast);

  const [report, setReport] = useState<ContextAuditReport | null>(null);
  const [plan, setPlan] = useState<CrossRefRepairPlan | null>(null);
  const [busy, setBusy] = useState<'audit' | 'plan' | 'apply' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);

  const runAudit = async (): Promise<ContextAuditReport | null> => {
    setBusy('audit');
    setFailed(false);
    try {
      const next = await auditContexts(projectId);
      setReport(next);
      return next;
    } catch {
      setFailed(true);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const runPlan = async () => {
    setBusy('plan');
    try {
      setPlan(await repairCrossRefs(projectId, false));
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  const applyRepair = async () => {
    setBusy('apply');
    try {
      const applied = await repairCrossRefs(projectId, true);
      setPlan(applied);
      addToast(tx(t.ctx_repair_applied, { contexts: applied.contextsWritten }), 'success');
      await runAudit();
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
      setConfirming(false);
    }
  };

  // Totals worth naming, in the order they matter. A dead pointer outranks a
  // context that is merely the wrong size: every agent navigating by this map
  // reads it as real.
  const totals = report
    ? ([
        ['unresolved_cross_ref', report.totals.unresolved_cross_refs],
        ['dangling_file_path', report.totals.dangling_files],
        ['file_overlap', report.totals.overlapping_files],
        ['uncategorized_context', report.totals.uncategorized_contexts],
        ['group_missing_domain', report.totals.groups_missing_domain],
        ['stale_context', report.totals.stale_contexts],
      ] as const).filter(([, n]) => n > 0)
    : [];

  return (
    <div className="mb-2 rounded-card border border-primary/10 bg-card/20">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-primary/8">
        <Stethoscope className="w-3.5 h-3.5 text-amber-400/80 flex-shrink-0" />
        <span className="typo-card-label">{t.ctx_audit_title}</span>
        {report && (
          <StatusBadge variant={report.balanced ? 'success' : 'warning'} pill>
            {report.balanced ? t.ctx_audit_balanced : t.ctx_audit_attention}
          </StatusBadge>
        )}
        {report && (
          <span className="typo-caption text-foreground tabular-nums">
            {tx(t.ctx_audit_scope, {
              contexts: report.totals.contexts,
              groups: report.totals.groups,
            })}
          </span>
        )}
        <Button
          variant="secondary"
          size="xs"
          className="ml-auto"
          icon={busy === 'audit' ? <LoadingSpinner size="sm" /> : <Stethoscope className="w-3 h-3" />}
          disabled={busy !== null}
          onClick={() => void runAudit()}
        >
          {busy === 'audit' ? t.ctx_audit_running : t.ctx_audit_run}
        </Button>
      </div>

      <div className="px-4 py-3 space-y-3">
        {failed && <p className="typo-caption text-rose-300">{t.ctx_audit_failed}</p>}

        {!report && !failed && <p className="typo-caption text-foreground">{t.ctx_audit_never_run}</p>}

        {report && totals.length > 0 && (
          <ul className="flex flex-wrap gap-x-5 gap-y-1">
            {totals.map(([kind, n]) => (
              <li key={kind} className="typo-caption text-foreground">
                <span className="tabular-nums font-semibold">{n}</span> {kindLabel(t, kind)}
              </li>
            ))}
          </ul>
        )}

        {report && report.findings.length > 0 && (
          <ul className="divide-y divide-primary/5 max-h-56 overflow-y-auto rounded-input border border-primary/8">
            {report.findings.map((f, i) => (
              <li key={`${f.kind}-${f.target}-${i}`} className="flex items-center gap-2.5 px-3 py-1.5">
                <StatusBadge variant={SEVERITY_VARIANT[f.severity] ?? 'neutral'} pill>
                  {severityLabel(t, f.severity)}
                </StatusBadge>
                <span className="typo-caption text-foreground min-w-0 flex-1 truncate">
                  {kindLabel(t, f.kind)}
                </span>
                <span className="typo-caption text-foreground shrink-0 truncate max-w-[45%]">{f.target}</span>
              </li>
            ))}
          </ul>
        )}

        {report && report.totals.unresolved_cross_refs > 0 && (
          <div className="rounded-input border border-primary/10 bg-background/30 p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="typo-caption text-foreground flex-1 min-w-[12rem]">
                {t.ctx_repair_intro}
              </span>
              <Button
                variant="secondary"
                size="xs"
                icon={busy === 'plan' ? <LoadingSpinner size="sm" /> : <Wrench className="w-3 h-3" />}
                disabled={busy !== null}
                onClick={() => void runPlan()}
              >
                {busy === 'plan' ? t.ctx_repair_planning : t.ctx_repair_plan}
              </Button>
            </div>

            {plan && (
              <div className="space-y-2">
                <p className="typo-caption text-foreground tabular-nums">
                  {tx(t.ctx_repair_summary, {
                    resolved: plan.rewritten,
                    total: plan.danglingBefore,
                    unresolved: plan.unresolved,
                  })}
                </p>
                <p className="typo-caption text-foreground tabular-nums">
                  {tx(t.ctx_repair_detail, {
                    contexts: plan.contextsTouched,
                    self: plan.selfDropped,
                    dupes: plan.deduped,
                  })}
                </p>
                {plan.unresolvedNames.length > 0 && (
                  <details>
                    <summary className="typo-caption text-foreground cursor-pointer">
                      {tx(t.ctx_repair_unresolved_title, { count: plan.unresolvedNames.length })}
                    </summary>
                    <p className="typo-caption text-foreground mt-1">{t.ctx_repair_unresolved_note}</p>
                    <p className="typo-caption text-foreground mt-1 break-words">
                      {plan.unresolvedNames.join(', ')}
                    </p>
                  </details>
                )}
                {plan.ambiguous.length > 0 && (
                  <details>
                    <summary className="typo-caption text-foreground cursor-pointer">
                      {tx(t.ctx_repair_ambiguous_title, { count: plan.ambiguous.length })}
                    </summary>
                    <p className="typo-caption text-foreground mt-1">{t.ctx_repair_ambiguous_note}</p>
                    <p className="typo-caption text-foreground mt-1 break-words">
                      {plan.ambiguous.map((a) => a.name).join(', ')}
                    </p>
                  </details>
                )}
                {plan.contextsTouched > 0 ? (
                  <Button
                    variant="accent"
                    accentColor="amber"
                    size="xs"
                    icon={busy === 'apply' ? <LoadingSpinner size="sm" /> : <Wrench className="w-3 h-3" />}
                    disabled={busy !== null}
                    onClick={() => setConfirming(true)}
                  >
                    {busy === 'apply' ? t.ctx_repair_applying : t.ctx_repair_apply}
                  </Button>
                ) : (
                  <p className="typo-caption text-foreground">{t.ctx_repair_nothing}</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {confirming && plan && (
        <ConfirmDialog
          danger
          title={t.ctx_repair_confirm_title}
          body={tx(t.ctx_repair_confirm_body, { contexts: plan.contextsTouched })}
          confirmLabel={t.ctx_repair_confirm_cta}
          onConfirm={applyRepair}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

export default ContextMapHealth;
