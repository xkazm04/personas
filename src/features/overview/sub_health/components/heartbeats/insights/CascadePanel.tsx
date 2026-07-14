import { useMemo } from 'react';
import { GitBranch, ArrowRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import type { PersonaHealthSignal, CascadeLink } from '@/stores/slices/overview/personaHealthSlice';
import { InsightPanel } from './InsightPanel';
import { buildChains } from './data';
import { GradeDot } from '../primitives';
import { GRADE_THEME } from '../model';

export function CascadePanel({ links, signals }: { links: CascadeLink[]; signals: PersonaHealthSignal[] }) {
  const { t, tx } = useTranslation();
  const c = t.overview.cascade;
  const chains = useMemo(() => buildChains(links, signals), [links, signals]);
  const hasChains = chains.length > 0;

  // Per-edge co-failure strength, keyed source->target, for the arrow labels.
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
        <div className="flex flex-col gap-2.5">
          {chains.map((chain, ci) => (
            <div key={ci} className="flex items-center gap-1 overflow-x-auto pb-1">
              {chain.map((sig, i) => {
                const next = chain[i + 1];
                const strength = next ? strengthByEdge.get(`${sig.personaId}->${next.personaId}`) ?? 0 : 0;
                return (
                  <div key={sig.personaId} className="flex items-center gap-1 shrink-0">
                    <ChainNode signal={sig} />
                    {i < chain.length - 1 && (
                      <div className="flex flex-col items-center shrink-0 px-0.5">
                        <ArrowRight className="w-3.5 h-3.5 text-foreground" />
                        <span className="typo-caption tabular-nums text-foreground/70 leading-none">
                          {strength > 0
                            ? tx(c.cofail_pct, { pct: Math.round(strength * 100) })
                            : c.cofail_insufficient}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {signals.slice(0, 12).map(s => (
            <span key={s.personaId} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-card bg-secondary/40 border border-primary/10">
              <GradeDot grade={s.grade} />
              <PersonaIcon icon={s.personaIcon} color={s.personaColor} display="framed" frameSize="xs" />
              <span className="typo-caption text-foreground truncate max-w-[120px]">{s.personaName}</span>
            </span>
          ))}
        </div>
      )}
    </InsightPanel>
  );
}

function ChainNode({ signal }: { signal: PersonaHealthSignal }) {
  const th = GRADE_THEME[signal.grade];
  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-card bg-secondary/40 border border-primary/10">
      <GradeDot grade={signal.grade} />
      <PersonaIcon icon={signal.personaIcon} color={signal.personaColor} display="framed" frameSize="xs" />
      <div className="min-w-0">
        <p className="typo-caption text-foreground truncate max-w-[80px]">{signal.personaName}</p>
        <p className={`typo-data tabular-nums ${th.text}`}>{signal.heartbeatScore}</p>
      </div>
    </div>
  );
}
