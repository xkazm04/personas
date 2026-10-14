// The mandate page's rail: the acts the page offers on the envelope, then
// the envelope itself, read-only. Suspend / Resume (S), revert the selected act (V), take the
// selected act's scope back (N). Signing and widening are the Sign card's
// (WP5), so they are not offered here at all rather than shown disabled.
//
// Suspend is calm at rest (annunciator grammar): a neutral door whose pause
// glyph carries the red, never a solid red slab on a quiet page. Each key sits
// clear of its label, so a label that wraps never runs into its keycap.
//
// Every door awaits its write (AsyncButton) and reports a refusal in place:
// an irreversible act says why before anything is pressed, and if the backend
// refuses anyway (`forbidden`) the same reason stays on screen.

import { Pause, Play, Shrink, Undo2 } from 'lucide-react';
import { AsyncButton } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { KeyValueGrid } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { CharterAct } from '@/lib/bindings/CharterAct';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import { Kbd } from '../parts';
import { asScope, mergeLabel, scopeLabel, statusLabel } from './mandateCopy';

/** The scope the selected act was taken under, when the envelope still grants it. */
export function narrowableScope(mandate: MandateSummary, act: CharterAct | null) {
  const scope = act ? asScope(act.scope) : null;
  if (!scope || mandate.envelope.envelopeVersion === 0) return null;
  return mandate.envelope.decideScopes.includes(scope) ? scope : null;
}

/** A door's key, kept clear of its label: the button's gap plus its own margin. */
function RailKey({ k }: { k: string }) {
  return <span className="ml-1.5 inline-flex"><Kbd>{k}</Kbd></span>;
}

export function canRevert(act: CharterAct | null): boolean {
  return !!act && act.reversible && act.revertedAt === null && act.itemKind !== 'act.revert';
}

export function MandateRail({ mandate, held, act, notice, onSuspend, onRevert, onNarrow }: {
  mandate: MandateSummary;
  held: number | null;
  /** The selected act, or null. */
  act: CharterAct | null;
  /** The last refusal or failure, said in place. */
  notice: string | null;
  onSuspend: () => Promise<void>;
  onRevert: () => Promise<void>;
  onNarrow: () => Promise<void>;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const env = mandate.envelope;
  const { spendUsedUsd: used, budgetUsd: cap } = mandate.load;
  const suspended = mandate.status === 'suspended';
  const narrow = narrowableScope(mandate, act);
  const num = (n: number | null) => (n === null ? null : <Numeric value={n} />);

  return (
    <aside className="flex w-[300px] flex-shrink-0 flex-col gap-3 overflow-y-auto border-l border-foreground/10 pl-4" data-testid="mandate-rail">
      <div className="flex flex-col gap-2 border-b border-foreground/10 pb-3">
        <AsyncButton
          variant="secondary"
          size="sm"
          block
          onClick={onSuspend}
          icon={suspended ? <Play className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4 text-status-error" aria-hidden />}
          iconRight={<RailKey k="S" />}
          aria-keyshortcuts="S"
          data-testid="mandate-suspend"
        >
          {suspended ? m.ml_resume : m.ml_suspend}
        </AsyncButton>
        {act && (canRevert(act) ? (
          <AsyncButton variant="secondary" size="sm" block onClick={onRevert} icon={<Undo2 className="h-4 w-4" aria-hidden />} iconRight={<RailKey k="V" />} aria-keyshortcuts="V" data-testid="mandate-revert">
            {m.ml_revert}
          </AsyncButton>
        ) : (
          <p className="typo-caption" data-testid="mandate-revert-reason">
            {act.revertedAt ? m.ml_revert_already : act.itemKind === 'act.revert' ? m.ml_revert_is_revert : m.ml_revert_final}
          </p>
        ))}
        {narrow && (
          <AsyncButton variant="secondary" size="sm" block onClick={onNarrow} icon={<Shrink className="h-4 w-4" aria-hidden />} iconRight={<RailKey k="N" />} aria-keyshortcuts="N" data-testid="mandate-narrow">
            {tx(m.ml_narrow, { scope: scopeLabel(m, narrow) })}
          </AsyncButton>
        )}
        <p className="typo-caption text-status-warning" role="status" data-testid="mandate-notice">{notice}</p>
      </div>
      <span className="typo-eyebrow">{m.ml_envelope}</span>
      <KeyValueGrid
        min="100%"
        items={[
          { k: m.ml_fact_status, v: statusLabel(m, mandate.status) },
          { k: m.ml_fact_version, v: env.envelopeVersion === 0 ? m.ml_envelope_unsigned : tx(m.ml_act_version, { version: env.envelopeVersion }) },
          { k: m.ml_fact_decides, v: env.decideScopes.length === 0 ? m.ml_envelope_decides_none : env.decideScopes.map((s) => scopeLabel(m, s)).join(', ') },
          { k: m.ml_fact_merge, v: mergeLabel(m, env.mergePolicy) },
          {
            k: m.ml_fact_budget,
            v: cap === null ? m.ml_steward_no_cap : used === null ? m.ml_steward_spend_unknown
              : <><Numeric value={used} unit="usd" /> / <Numeric value={cap} unit="usd" /></>,
          },
          { k: m.ml_fact_rung, v: num(mandate.scopeRung) },
          { k: m.ml_fact_acts, v: num(mandate.load.actsCount), none: m.ml_unknown },
          { k: m.ml_fact_asks, v: num(mandate.load.openAsks), none: m.ml_unknown },
          { k: m.ml_fact_held, v: num(held), none: m.ml_unknown },
        ]}
      />
    </aside>
  );
}
