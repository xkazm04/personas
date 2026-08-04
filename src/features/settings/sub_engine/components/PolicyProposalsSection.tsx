import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, RefreshCw, X } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { policyTuningGenerate, policyTuningList } from '@/api/system/policyTuning';
import type { PolicyProposal, PolicyTuningGenerationReport } from '@/api/system/policyTuning';
import type { DeclinedCell } from '@/lib/bindings/DeclinedCell';
import { Button, AsyncButton } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { AthenaComposedBadge } from '@/features/shared/components/feedback/AthenaComposedBadge';
import { decidePolicyProposalRow } from '@/lib/decisions/rowWrites';
import { toastCatch } from '@/lib/silentCatch';

const INPUT_CLS =
  'rounded-input border border-primary/10 bg-secondary/40 px-2 py-1 typo-body text-foreground';

const pct = (v: number) => Math.round(v * 100);
const signedPct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}`;
const usd = (v: number) => v.toFixed(2);

/**
 * Self-Tuning Fabric v1 (batch-3): the review-each proposals feed inside the
 * Model Routing section. Every proposal shows its quantified claim and an
 * evidence drawer with the raw snapshot slice; apply writes the rule with
 * provenance, decline records feedback. When the generator declines to
 * propose (evidence floor / hysteresis / quality), those reasons are shown
 * verbatim — sparse data reads as sparse data.
 *
 * DELIBERATELY NOT DELEGATED to the triage deck, which now also decides these
 * rows (`quick-answer/triage/triageAdapters#policyProposalToTriage`). The two
 * surfaces answer different questions and only one of them is triage:
 *
 *  • This section is the SUBSYSTEM's page. It runs the generator, reports the
 *    cells the generator declined to propose for and why, and keeps decided
 *    history visible (`policyTuningList(false, …)`) so an operator can audit
 *    what tuning has done to their routing. None of that is a pending decision,
 *    and none of it belongs on a card.
 *  • The deck is the fast lane over the PENDING half, mixed in with every other
 *    row waiting on a human.
 *
 * They share the write, not the layout: both go through
 * `lib/decisions/rowWrites#decidePolicyProposalRow` → `policyTuningApply` /
 * `policyTuningDecline`, which is the Fabric's single-writer contract. Folding
 * this section into `TriageItem` would have cost the generator controls and the
 * declined-cells report to gain a card shape it does not need.
 */
export function PolicyProposalsSection({ onRulesChanged }: { onRulesChanged?: () => void }) {
  const { t, tx } = useTranslation();
  const s = t.settings.engine;
  const [proposals, setProposals] = useState<PolicyProposal[]>([]);
  const [report, setReport] = useState<PolicyTuningGenerationReport | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState('');

  const refresh = useCallback(() => {
    policyTuningList(false, 50)
      .then(setProposals)
      .catch(toastCatch('PolicyProposalsSection:list'));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const generate = async () => {
    try {
      const r = await policyTuningGenerate();
      setReport(r);
      refresh();
    } catch (e) {
      toastCatch('PolicyProposalsSection:generate')(e);
    }
  };

  // Both verdicts go through the shared door, carrying the status this list
  // RENDERED — so a proposal Athena applied while the page sat open fails here
  // exactly as it fails in the deck, instead of two surfaces racing.
  const apply = async (proposal: PolicyProposal) => {
    try {
      await decidePolicyProposalRow(proposal.id, 'apply', { seenStatus: proposal.status });
      refresh();
      onRulesChanged?.();
    } catch (e) {
      toastCatch('PolicyProposalsSection:apply')(e);
    }
  };

  const confirmDecline = async (proposal: PolicyProposal) => {
    try {
      await decidePolicyProposalRow(proposal.id, 'decline', {
        seenStatus: proposal.status,
        reason: declineReason,
      });
      setDecliningId(null);
      setDeclineReason('');
      refresh();
    } catch (e) {
      toastCatch('PolicyProposalsSection:decline')(e);
    }
  };

  const basisLabel = (basis: string) =>
    basis === 'lab' ? s.tuning_basis_lab : s.tuning_basis_success_rate;

  const claimLine = (p: PolicyProposal): string => {
    if (p.kind === 'routing_rule' && p.routing) {
      const c = p.routing.claim;
      return tx(s.tuning_claim_routing, {
        category: p.routing.category ?? '*',
        from: p.routing.fromModel ?? '?',
        to: p.routing.toModel,
        savingPct: pct(c.savingPct),
        saving: usd(c.projectedMonthlySavingUsd),
      });
    }
    if (p.kind === 'budget_ceiling' && p.budget) {
      const b = p.budget;
      const params = {
        current: usd(b.currentCeilingUsd),
        proposed: usd(b.proposedCeilingUsd),
        observed: usd(b.observedMonthlySpendUsd),
        rows: b.spendRows,
      };
      if (b.direction === 'introduce') return tx(s.tuning_budget_introduce, params);
      if (b.direction === 'raise') return tx(s.tuning_budget_raise, params);
      return tx(s.tuning_budget_lower, params);
    }
    return p.kind;
  };

  const declinedLine = (d: DeclinedCell): string => {
    const params = {
      category: d.category,
      model: d.incumbentModel,
      runs: d.runs,
      floor: d.floor,
    };
    switch (d.reason) {
      case 'below_evidence_floor':
        return tx(s.tuning_reason_below_evidence_floor, params);
      case 'no_qualified_challenger':
        return tx(s.tuning_reason_no_qualified_challenger, params);
      case 'saving_below_threshold':
        return tx(s.tuning_reason_saving_below_threshold, params);
      case 'quality_regression':
        return tx(s.tuning_reason_quality_regression, params);
      case 'already_routed':
        return tx(s.tuning_reason_already_routed, params);
      default:
        return d.reason;
    }
  };

  const statusLabel = (status: string) =>
    status === 'applied'
      ? s.tuning_status_applied
      : status === 'declined'
        ? s.tuning_status_declined
        : s.tuning_status_pending;

  const pending = useMemo(() => proposals.filter((p) => p.status === 'pending'), [proposals]);
  const decided = useMemo(() => proposals.filter((p) => p.status !== 'pending'), [proposals]);

  const renderEvidence = (p: PolicyProposal) => {
    const cells =
      p.kind === 'routing_rule'
        ? p.evidence.cells.filter((c) => c.category === (p.routing?.category ?? c.category))
        : p.evidence.cells;
    return (
      <div className="mt-2 space-y-2 rounded-card border border-primary/10 bg-secondary/30 p-3">
        <p className="typo-caption text-foreground">
          {tx(s.tuning_evidence_snapshot, {
            id: p.evidenceSnapshotId,
            days: p.evidence.windowDays,
            date: new Date(p.evidence.generatedAt).toLocaleString(),
          })}
        </p>
        {p.kind === 'routing_rule' && (
          <div className="overflow-x-auto">
            <table className="min-w-full typo-caption text-foreground">
              <thead>
                <tr className="text-left text-foreground">
                  <th className="pr-4 py-1">{s.tuning_evidence_model}</th>
                  <th className="pr-4 py-1">{s.tuning_evidence_runs}</th>
                  <th className="pr-4 py-1">{s.tuning_evidence_success}</th>
                  <th className="pr-4 py-1">{s.tuning_evidence_cost}</th>
                  <th className="py-1">{s.tuning_evidence_lab}</th>
                </tr>
              </thead>
              <tbody>
                {cells.map((c) => (
                  <tr key={`${c.category}:${c.model}`} className="border-t border-primary/5">
                    <td className="pr-4 py-1 font-mono">{c.model}</td>
                    <td className="pr-4 py-1">{c.runs}</td>
                    <td className="pr-4 py-1">{pct(c.successRate)}%</td>
                    <td className="pr-4 py-1">
                      <Numeric value={c.avgCostUsd} unit="usd" precision={4} />
                    </td>
                    <td className="py-1">
                      {c.avgLabQuality != null ? (
                        <>
                          <Numeric value={c.avgLabQuality} precision={1} /> (n={c.labSamples})
                        </>
                      ) : (
                        s.tuning_evidence_lab_none
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {p.evidence.healing.attempted > 0 && (
          <p className="typo-caption text-foreground">
            {tx(s.tuning_healing_note, {
              rate: pct(p.evidence.healing.success_rate),
              attempted: p.evidence.healing.attempted,
            })}
          </p>
        )}
      </div>
    );
  };

  const renderProposal = (p: PolicyProposal) => {
    const isOpen = !!expanded[p.id];
    return (
      <div key={p.id} className="rounded-card border border-primary/10 bg-secondary/20 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <AthenaComposedBadge
            variant="composed"
            label={statusLabel(p.status)}
            title={p.evidenceSnapshotId}
          />
          <span className="typo-body text-foreground flex-1 min-w-48">{claimLine(p)}</span>
        </div>
        {p.kind === 'routing_rule' && p.routing && (
          <p className="mt-1 typo-caption text-foreground">
            {tx(s.tuning_claim_quality, {
              delta: signedPct(p.routing.claim.qualityDeltaPct),
              basis: basisLabel(p.routing.claim.qualityBasis),
              incRuns: p.routing.claim.incumbentRuns,
              chRuns: p.routing.claim.challengerRuns,
            })}
          </p>
        )}
        {p.status === 'declined' && p.declineReason && (
          <p className="mt-1 typo-caption text-foreground">
            {tx(s.tuning_decline_reason_label, { reason: p.declineReason })}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => setExpanded((e) => ({ ...e, [p.id]: !isOpen }))}
          >
            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            {isOpen ? s.tuning_evidence_hide : s.tuning_evidence_show}
          </Button>
          {p.status === 'pending' && decliningId !== p.id && (
            <>
              <AsyncButton variant="primary" onClick={() => apply(p)}>
                <Check className="w-4 h-4" />
                {s.tuning_apply}
              </AsyncButton>
              <Button variant="secondary" onClick={() => setDecliningId(p.id)}>
                <X className="w-4 h-4" />
                {s.tuning_decline}
              </Button>
            </>
          )}
          {p.status === 'pending' && decliningId === p.id && (
            <>
              <input
                className={`${INPUT_CLS} flex-1 min-w-48`}
                value={declineReason}
                placeholder={s.tuning_decline_reason_ph}
                onChange={(e) => setDeclineReason(e.target.value)}
              />
              <AsyncButton variant="secondary" onClick={() => confirmDecline(p)}>
                {s.tuning_decline_confirm}
              </AsyncButton>
            </>
          )}
        </div>
        {isOpen && renderEvidence(p)}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <h4 className="typo-body font-medium text-foreground">{s.tuning_title}</h4>
        <p className="typo-caption text-foreground">{s.tuning_subtitle}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <AsyncButton variant="secondary" onClick={generate}>
          <RefreshCw className="w-4 h-4" />
          {s.tuning_generate}
        </AsyncButton>
        {report && (
          <span className="typo-caption text-foreground">
            {tx(s.tuning_floor_note, {
              runs: report.evidenceFloorRuns,
              lab: report.minLabSamples,
              spend: report.minSpendRows,
            })}
          </span>
        )}
      </div>

      {report && report.created.length === 0 && (
        <p className="typo-caption text-foreground">{s.tuning_generated_none}</p>
      )}
      {report && report.skippedExisting > 0 && (
        <p className="typo-caption text-foreground">
          {tx(s.tuning_skipped_existing, { count: report.skippedExisting })}
        </p>
      )}

      {report && report.declined.length > 0 && (
        <div className="space-y-1">
          <p className="typo-caption font-medium text-foreground">{s.tuning_declined_title}</p>
          {report.declined.map((d) => (
            <p key={`${d.category}:${d.incumbentModel}:${d.reason}`} className="typo-caption text-foreground">
              {declinedLine(d)}
            </p>
          ))}
        </div>
      )}

      {proposals.length === 0 && !report && (
        <p className="typo-body text-foreground">{s.tuning_empty}</p>
      )}

      {pending.length > 0 && <div className="space-y-2">{pending.map(renderProposal)}</div>}

      {decided.length > 0 && (
        <div className="space-y-2">
          <p className="typo-caption font-medium text-foreground">{s.tuning_history_title}</p>
          {decided.map(renderProposal)}
        </div>
      )}
    </div>
  );
}
