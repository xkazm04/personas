// The envelope as a plate of the panel (the Sessions plate's grammar): an
// engraved head with the version, ONE dominant figure - spend against the cap,
// drawn as the Usage plate's bar - then the load as four figures in a row and
// the two policies as quiet key/value facts. Read-only: the doors that change
// it are the page's (Suspend) and the Sign card's.

import { KeyValueGrid } from '@/features/shared/components/kit';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import { Engraved } from '../parts';
import { mergeLabel, scopeLabel } from './mandateCopy';
import { Figure, SpendBar, spendShare } from './rowParts';

function Load({ label, n, warn = false }: { label: string; n: number | null; warn?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <Engraved className="truncate">{label}</Engraved>
      <Figure n={n} warn={warn} none={t.monitor.ml_unknown} />
    </div>
  );
}

export function EnvelopePlate({ mandate, held, testId = 'mandate-envelope' }: {
  mandate: MandateSummary;
  /** Items held on the charter; null when the lanes snapshot is not read. */
  held: number | null;
  testId?: string;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const env = mandate.envelope;
  const { spendUsedUsd: used, budgetUsd: cap, actsCount, openAsks } = mandate.load;
  const share = spendShare(used, cap);

  return (
    <section className="ae-plate ml-plate flex flex-col gap-3 rounded-card p-3" aria-label={m.ml_envelope} data-testid={testId}>
      <header className="flex items-center gap-2">
        <Engraved>{m.ml_envelope}</Engraved>
        <span className="ml-auto typo-caption tabular-nums">
          {env.envelopeVersion === 0 ? m.ml_envelope_unsigned : tx(m.ml_act_version, { version: env.envelopeVersion })}
        </span>
      </header>
      <div className="flex flex-col gap-1.5">
        <Engraved>{m.ml_fact_budget}</Engraved>
        {cap === null || used === null ? (
          <span className="typo-body text-foreground">{cap === null ? m.ml_steward_no_cap : m.ml_steward_spend_unknown}</span>
        ) : (
          <span className={`typo-data-lg tabular-nums ${share !== null && share >= 1 ? 'text-status-error' : 'text-foreground'}`}>
            <Numeric value={used} unit="usd" /><span className="typo-data"> / <Numeric value={cap} unit="usd" /></span>
          </span>
        )}
        <SpendBar used={used} cap={cap} />
      </div>
      <div className="grid grid-cols-4 gap-2 border-t border-foreground/10 pt-2.5">
        <Load label={m.ml_fact_rung} n={mandate.scopeRung} />
        <Load label={m.ml_fact_acts} n={actsCount} />
        <Load label={m.ml_col_asks} n={openAsks} warn />
        <Load label={m.ml_fact_held} n={held} />
      </div>
      <div className="border-t border-foreground/10 pt-1.5">
        <KeyValueGrid
          min="100%"
          items={[
            { k: m.ml_fact_decides, v: env.decideScopes.length === 0 ? m.ml_envelope_decides_none : env.decideScopes.map((s) => scopeLabel(m, s)).join(', ') },
            { k: m.ml_fact_merge, v: mergeLabel(m, env.mergePolicy) },
          ]}
        />
      </div>
    </section>
  );
}
