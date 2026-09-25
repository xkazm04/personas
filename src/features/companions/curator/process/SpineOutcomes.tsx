import { useTranslation } from '@/i18n/useTranslation';
import { DEV_OUTCOMES } from './engine/devAdapter';
import { OUTCOME_TONE, outcomeName, pct } from './labels';

/** Where the river ends: every session counted once, by how it ended. */
export function SpineOutcomes({ outcomes, total }: { outcomes: Record<string, number>; total: number }) {
  const { t } = useTranslation();
  const p = t.companions.process;
  const rows = DEV_OUTCOMES.map((o) => ({ o, n: outcomes[o] ?? 0 })).filter((r) => r.n > 0);

  return (
    <section className="mt-2 border-t border-primary/10 pt-8" data-testid="process-outcomes">
      <h2 className="typo-heading">{p.outcomes_title}</h2>
      <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-secondary/60">
        {rows.map((r) => (
          <span key={r.o} className={OUTCOME_TONE[r.o]} style={{ width: `${(100 * r.n) / (total || 1)}%` }} />
        ))}
      </div>
      <ul className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
        {rows.map((r) => (
          <li key={r.o} className="flex items-center gap-2 typo-body">
            <span className={`h-3 w-3 rounded-interactive ${OUTCOME_TONE[r.o]}`} />
            {outcomeName(p, r.o)}
            <span className="typo-data">{r.n}</span>
            <span className="typo-caption tabular-nums">{pct(r.n, total)}%</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
