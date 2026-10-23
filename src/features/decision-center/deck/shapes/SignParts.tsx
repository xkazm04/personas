/**
 * The Sign card's envelope rows: what the steward decides alone, the merge
 * policy, the spend cap. Each row reads as a sentence; under `E` the scopes
 * and the cap become editable. The merge policy is ALWAYS a live choice of
 * the three: signing is the moment the operator picks it, so it is never a
 * value inherited without being seen.
 */
import { useMemo, type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { NumberStepper } from '@/features/shared/components/forms/NumberStepper';
import { mergeLabel, scopeLabel } from '@/features/fleet/monitor/grid/prototype/entry-e/mandate/mandateCopy';
import { useTranslation } from '@/i18n/useTranslation';
import type { MandateSignInput } from '@/lib/bindings/MandateSignInput';
import { ALL_SCOPES, MERGE_POLICIES, toggleScope, type EnvelopeGrant } from '../../mandate/envelope';
import { Keycap } from '../parts';

/** Whole dollars, in the reader's own number format. */
export function useUsd(): (usd: number) => string {
  const { language } = useTranslation();
  return useMemo(() => {
    const f = new Intl.NumberFormat(language, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    return (usd: number) => f.format(usd);
  }, [language]);
}

/**
 * One envelope row: the eyebrow label in a narrow column (it may take two
 * lines), the value beside it. A `note` sits under the label, in the room the
 * value's own height leaves there, so explaining a row never costs the card a
 * line (the merge hint: residue item 5, the Sign card decidable at 1280x800
 * without scrolling).
 */
export function EnvelopeRow({ label, note, testId, stacked = false, children }: { label: string; note?: string; testId: string; stacked?: boolean; children: ReactNode }) {
  return (
    <section className={`grid items-start gap-x-4 gap-y-1 ${stacked ? 'grid-cols-1' : 'grid-cols-[11rem_1fr]'}`} data-testid={testId}>
      <span className="flex flex-col gap-1 pt-0.5">
        <span className="typo-eyebrow text-foreground">{label}</span>
        {note && <span className="typo-caption [text-wrap:pretty]" data-testid={`${testId}-note`}>{note}</span>}
      </span>
      <div className="flex min-w-0 flex-col gap-1.5">{children}</div>
    </section>
  );
}

export function ScopesRow({ draft, editing, onChange }: { draft: MandateSignInput; editing: boolean; onChange: (d: MandateSignInput) => void }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  if (!editing) {
    return (
      <EnvelopeRow label={m.ml_sign_scopes} testId="sign-scopes">
        <span className="typo-body text-foreground [text-wrap:pretty]">
          {draft.decideScopes.length === 0 ? m.ml_sign_scopes_none : draft.decideScopes.map((s) => scopeLabel(m, s)).join(' · ')}
        </span>
      </EnvelopeRow>
    );
  }
  return (
    <EnvelopeRow label={m.ml_sign_scopes} testId="sign-scopes" stacked>
      <div className="grid grid-cols-3 gap-x-6 gap-y-1.5">
        {ALL_SCOPES.map((s) => (
          <span key={s} className="flex items-center gap-2.5">
            <AccessibleToggle
              size="sm"
              checked={draft.decideScopes.includes(s)}
              onChange={() => onChange(toggleScope(draft, s))}
              label={tx(m.ml_sign_scope_toggle, { scope: scopeLabel(m, s) })}
              data-testid={`sign-scope-${s}`}
              className="flex-shrink-0"
            />
            <span className="typo-body whitespace-nowrap text-foreground">{scopeLabel(m, s)}</span>
          </span>
        ))}
      </div>
    </EnvelopeRow>
  );
}

export function MergeRow({ draft, onChange }: { draft: MandateSignInput; onChange: (d: MandateSignInput) => void }) {
  const { t } = useTranslation();
  const m = t.monitor;
  return (
    <EnvelopeRow label={m.ml_sign_merge} note={m.ml_sign_merge_hint} testId="sign-merge">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={m.ml_sign_merge}>
        {MERGE_POLICIES.map((p) => {
          const on = draft.mergePolicy === p;
          return (
            <Button
              key={p}
              variant="ghost"
              size="sm"
              role="radio"
              aria-checked={on}
              data-accent={on ? '' : undefined}
              onClick={() => onChange({ ...draft, mergePolicy: p })}
              className="au-branch au-lift rounded-input px-3! hover:bg-transparent"
              data-testid={`sign-merge-${p}`}
            >
              <span className={`typo-body whitespace-nowrap ${on ? 'text-primary' : 'text-foreground'}`}>{mergeLabel(m, p)}</span>
            </Button>
          );
        })}
      </div>
    </EnvelopeRow>
  );
}

export function CapRow({ cap, editing, onChange }: { cap: number | null; editing: boolean; onChange: (usd: number | null) => void }) {
  const { t } = useTranslation();
  const m = t.monitor;
  const usd = useUsd();
  return (
    <EnvelopeRow label={m.ml_sign_budget} testId="sign-cap">
      {editing ? (
        <NumberStepper value={cap} onChange={onChange} allowEmpty min={0} step={5} prefix="$" ariaLabel={m.ml_sign_budget_aria} className="max-w-[12rem]" />
      ) : (
        <span className="typo-body text-foreground">{cap !== null ? usd(cap) : m.ml_sign_budget_none}</span>
      )}
    </EnvelopeRow>
  );
}

/**
 * What an armed signature grants, listed before the second press. It sits in
 * the body (not the dock) so the rail keeps room for what the charter refuses.
 */
export function GrantsBox({ grants, envelope }: { grants: EnvelopeGrant[]; envelope: MandateSignInput }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const usd = useUsd();
  return (
    <div className="au-armed au-l-danger flex max-w-[68ch] flex-col gap-1.5 rounded-input px-3 py-2.5" role="alert" data-testid="sign-grants-box">
      <span className="au-ink-lamp flex items-center gap-1.5 typo-eyebrow">
        <Lock className="h-3.5 w-3.5" aria-hidden />
        {m.ml_sign_grants}
      </span>
      {grants.map((g) => (
        <span key={g} className="typo-body text-foreground">
          {g === 'merge'
            ? tx(m.ml_sign_grant_merge, { policy: mergeLabel(m, envelope.mergePolicy) })
            : tx(m.ml_sign_grant_spend, { cap: usd(envelope.budgetMonthlyUsd ?? 0) })}
        </span>
      ))}
      <span className="flex items-center gap-1.5 typo-caption">
        <Keycap>↵</Keycap> {m.ml_sign_grants_confirm}
        <Keycap>Esc</Keycap> {m.dc_deck_armed_disarm}
      </span>
    </div>
  );
}
