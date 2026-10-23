/**
 * The Breach card's sections: why it reached you (the clause, in one plain
 * sentence), the mandate's state when the card cannot amend it (unsigned,
 * none, not loaded), what would change if amended (only for an envelope
 * amend, where both sides are known), and the incident sheet a stop breach shows.
 */
import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { NumberStepper } from '@/features/shared/components/forms/NumberStepper';
import { mergeLabel, scopeLabel } from '@/features/fleet/monitor/grid/prototype/entry-e/mandate/mandateCopy';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import type { LaneClause } from '@/lib/bindings/LaneClause';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import type { DecisionItem } from '../../model/decisionModel';
import { clauseLine, type BreachMandateState, type BreachPlan } from '../../mandate/breachPlan';
import { FactLine } from '../FactLine';
import { useUsd } from './SignParts';

const CLAUSE_TONE: Record<LaneClause, string> = {
  stop: 'danger', valve: 'danger', risk: 'warning', merge: 'warning', spend: 'warning', scope: 'accent', unsigned: 'accent', none: 'neutral',
};

/** Why it reached you. `line` replaces the clause's generic sentence when the card knows more (the unsigned mandate, named). */
export function ClauseBand({ clause, line }: { clause: LaneClause; line?: string }) {
  const { t } = useTranslation();
  const m = t.monitor;
  return (
    <p className={`au-yes au-l-${CLAUSE_TONE[clause]} flex max-w-[68ch] flex-col gap-0.5 rounded-r-input py-1.5 pl-3 pr-3`} data-testid="breach-clause" data-clause={clause}>
      <span className="au-ink-lamp typo-label">{m.ml_breach_why}</span>
      <span className="typo-body text-foreground [text-wrap:pretty]">{line ?? clauseLine(m, clause)}</span>
    </p>
  );
}

/** The mandate's state when it is not a signed envelope: one sentence under its name. */
export function MandateState({ state, line }: { state: BreachMandateState; line: string }) {
  const { t } = useTranslation();
  return (
    <section className="flex max-w-[68ch] flex-col gap-1" data-testid="breach-mandate-state" data-state={state.kind}>
      <span className="typo-eyebrow text-foreground">{t.monitor.ml_breach_mandate}</span>
      <span className="typo-body text-foreground [text-wrap:pretty]">{line}</span>
    </section>
  );
}

function DiffRow({ label, from, to }: { label: string; from: string; to: ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr_auto_1fr] items-center gap-3">
      <span className="typo-eyebrow text-foreground">{label}</span>
      <span className="typo-body text-foreground">{from}</span>
      <ArrowRight className="h-4 w-4 au-quiet" aria-hidden />
      <span className="typo-body text-primary">{to}</span>
    </div>
  );
}

export function ClauseDiff({ plan, mandate, cap, onCap }: { plan: BreachPlan; mandate: MandateSummary | null; cap: number | null; onCap: (usd: number | null) => void }) {
  const { t } = useTranslation();
  const m = t.monitor;
  const usd = useUsd();
  const a = plan.amend;
  if (a.kind === 'item' || !mandate) return null;
  const scopes = mandate.envelope.decideScopes;
  return (
    <section className="flex max-w-[68ch] flex-col gap-2" data-testid="breach-diff">
      <span className="typo-eyebrow text-foreground">{m.ml_breach_diff}</span>
      {a.kind === 'scope' && (
        <DiffRow
          label={m.ml_fact_decides}
          from={scopes.length === 0 ? m.ml_envelope_decides_none : scopes.map((s) => scopeLabel(m, s)).join(' · ')}
          to={`+ ${scopeLabel(m, a.scope)}`}
        />
      )}
      {a.kind === 'merge' && <DiffRow label={m.ml_fact_merge} from={mergeLabel(m, a.from)} to={mergeLabel(m, a.to)} />}
      {a.kind === 'spend' && (
        <DiffRow
          label={m.ml_sign_budget}
          from={a.from === null ? m.ml_steward_no_cap : usd(a.from)}
          to={<NumberStepper value={cap} onChange={onCap} allowEmpty min={0} step={5} prefix="$" ariaLabel={m.ml_breach_cap_aria} className="max-w-[12rem]" />}
        />
      )}
    </section>
  );
}

/** A stop breach: the incident as a sheet (severity in words, then its facts). */
export function IncidentSheet({ item }: { item: DecisionItem }) {
  const { t } = useTranslation();
  const m = t.monitor;
  const sev = item.severity ? tokenLabel(t, 'severity', item.severity.toLowerCase()) : null;
  return (
    <section className="au-well flex max-w-[68ch] flex-col gap-2 rounded-card px-4 py-3" data-testid="breach-incident-sheet">
      <span className="flex items-center gap-2 typo-eyebrow text-foreground">
        {m.ml_breach_incident}
        {sev && <span className="text-status-error">{sev}</span>}
      </span>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
        {/* The rail already says who raised it and when; the sheet keeps the incident's own facts. */}
        {item.facts
          .filter((f) => f.id !== 'severity' && f.value !== item.createdAt && f.value !== item.source.label && !f.score)
          .map((f) => <FactLine key={f.id} fact={f} />)}
      </div>
    </section>
  );
}
