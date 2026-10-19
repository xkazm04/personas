import { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useAgentStore } from '@/stores/agentStore';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';

/**
 * F21: per (version × model) eval economics — attempts vs resolved and
 * cost-per-success. A compact sibling to the Versions & Ratings matrix; sorted
 * by cost efficiency (cheapest success first) so the model-tiering signal is
 * obvious. Additive — it never touches the load-bearing ratings matrix.
 */
export function LabEconomicsPanel({ personaId }: { personaId: string }) {
  const { t } = useTranslation();
  const { economics, fetchEconomics, promptVersions } = useAgentStore(
    useShallow((s) => ({
      economics: s.versionEconomics,
      fetchEconomics: s.fetchVersionEconomics,
      promptVersions: s.promptVersions,
    })),
  );
  // Rows are per (version x model): without the version a model measured on two
  // versions rendered as two identical-looking rows with different numbers.
  const versionNumberById = useMemo(
    () => new Map(promptVersions.map((v) => [v.id, v.version_number])),
    [promptVersions],
  );

  useEffect(() => {
    if (personaId) fetchEconomics(personaId);
  }, [personaId, fetchEconomics]);

  // Cheapest success first; rows that never resolved (null cost/success) sink.
  const rows = [...economics].sort(
    (a, b) =>
      (a.costPerSuccess ?? Number.POSITIVE_INFINITY) -
      (b.costPerSuccess ?? Number.POSITIVE_INFINITY),
  );

  return (
    <section className="rounded-card border border-border/40 bg-secondary/30 p-4">
      <header className="mb-3">
        <h3 className="typo-title">{t.agents.lab.eco_title}</h3>
        <p className="typo-caption text-foreground">{t.agents.lab.eco_subtitle}</p>
      </header>

      {rows.length === 0 ? (
        <p className="typo-body text-foreground">{t.agents.lab.eco_empty}</p>
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr className="typo-caption text-foreground">
              <th className="py-1 pr-3 typo-caption font-mono uppercase tracking-widest text-foreground">{t.agents.lab.vr_col_version}</th>
              <th className="py-1 px-3 typo-caption font-mono uppercase tracking-widest text-foreground">{t.agents.lab.eco_col_model}</th>
              <th className="py-1 px-3 text-right typo-caption font-mono uppercase tracking-widest text-foreground">{t.agents.lab.eco_col_attempted}</th>
              <th className="py-1 px-3 text-right typo-caption font-mono uppercase tracking-widest text-foreground">{t.agents.lab.eco_col_resolved}</th>
              <th className="py-1 px-3 text-right typo-caption font-mono uppercase tracking-widest text-foreground">{t.agents.lab.eco_col_rate}</th>
              <th className="py-1 pl-3 text-right typo-caption font-mono uppercase tracking-widest text-foreground">{t.agents.lab.eco_col_cost_success}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={`${r.versionId}::${r.modelId}`}
                className="typo-body text-foreground border-t border-border/20"
              >
                <td className="py-1.5 pr-3 font-mono">
                  {versionNumberById.has(r.versionId) ? `v${versionNumberById.get(r.versionId)}` : '—'}
                </td>
                <td className="py-1.5 px-3">{r.modelId}</td>
                <td className="py-1.5 px-3 text-right">
                  <Numeric value={r.attempted} unit="count" />
                </td>
                <td className="py-1.5 px-3 text-right">
                  <Numeric value={r.resolved} unit="count" />
                </td>
                <td className="py-1.5 px-3 text-right">
                  {r.resolveRate == null ? (
                    <span aria-hidden>—</span>
                  ) : (
                    <Numeric value={r.resolveRate * 100} unit="percent" precision={0} />
                  )}
                </td>
                <td className="py-1.5 pl-3 text-right">
                  {r.costPerSuccess == null ? (
                    <span aria-hidden>—</span>
                  ) : (
                    <Numeric value={r.costPerSuccess} unit="usd" precision={3} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
