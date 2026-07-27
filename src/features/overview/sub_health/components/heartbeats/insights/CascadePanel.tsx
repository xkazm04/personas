import { useMemo } from 'react';
import { GitBranch, ArrowRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaHealthSignal, CascadeLink } from '@/stores/slices/overview/personaHealthSlice';
import { InsightPanel } from './InsightPanel';
import { buildChains } from './data';
import { GRADE_THEME } from '../model';

export function CascadePanel({ links, signals }: { links: CascadeLink[]; signals: PersonaHealthSignal[] }) {
  const { t, tx } = useTranslation();
  const c = t.overview.cascade;
  const chains = useMemo(() => buildChains(links, signals), [links, signals]);
  const hasChains = chains.length > 0;

  // Per-edge co-failure strength, keyed source->target, for the row's edge labels.
  const strengthByEdge = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of links) m.set(`${l.sourcePersonaId}->${l.targetPersonaId}`, l.strength);
    return m;
  }, [links]);

  return (
    <InsightPanel
      icon={GitBranch}
      accent="primary"
      title={c.title}
      subtitle={hasChains ? `${chains.length} ${t.overview.heartbeats.chains}` : c.no_chains}
    >
      {hasChains ? (
        <div className="flex flex-col divide-y divide-primary/5">
          {chains.map((chain, ci) => (
            <div key={ci} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
              {/* Identifying text: the chain's persona sequence. Truncates as a
                  unit so a long chain never pushes the row wider than the
                  section — this is the one element in the row that carries
                  weight (Text Antipattern rule). */}
              <div className="min-w-0 flex-1 flex items-center gap-1 overflow-hidden">
                {chain.map((sig, i) => {
                  const next = chain[i + 1];
                  return (
                    <span key={sig.personaId} className="flex items-center gap-1 min-w-0">
                      <span className={`typo-body font-medium truncate ${GRADE_THEME[sig.grade].text}`}>
                        {sig.personaName}
                      </span>
                      {next && <ArrowRight className="w-3 h-3 text-foreground shrink-0" />}
                    </span>
                  );
                })}
              </div>
              {/* Metadata: per-edge co-failure strength, right-aligned and
                  never wrapped — normal weight + muted. */}
              <div className="shrink-0 flex items-center gap-2 typo-caption tabular-nums text-foreground">
                {chain.slice(0, -1).map((sig, i) => {
                  const next = chain[i + 1]!;
                  const strength = strengthByEdge.get(`${sig.personaId}->${next.personaId}`) ?? 0;
                  return (
                    <span key={sig.personaId}>
                      {strength > 0 ? tx(c.cofail_pct, { pct: Math.round(strength * 100) }) : c.cofail_insufficient}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-primary/5">
          {signals.slice(0, 12).map(s => (
            <div key={s.personaId} className="flex items-center gap-3 py-1.5 first:pt-0 last:pb-0">
              <span className={`typo-body font-medium truncate min-w-0 flex-1 ${GRADE_THEME[s.grade].text}`}>
                {s.personaName}
              </span>
              <span className="shrink-0 typo-caption tabular-nums text-foreground">{s.heartbeatScore}</span>
            </div>
          ))}
        </div>
      )}
    </InsightPanel>
  );
}
