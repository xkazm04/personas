import { useMemo } from 'react';
import { GitBranch, ArrowRight } from 'lucide-react';
import type { CascadeLink, PersonaHealthSignal } from '@/stores/slices/overview/personaHealthSlice';
import { useTranslation } from '@/i18n/useTranslation';

interface CascadeVisualizationProps {
  links: CascadeLink[];
  signals: PersonaHealthSignal[];
}

const GRADE_DOT = {
  healthy: 'bg-emerald-400',
  degraded: 'bg-amber-400',
  critical: 'bg-red-400',
  unknown: 'bg-zinc-500',
} as const;

const GRADE_RING = {
  healthy: 'ring-emerald-400/30',
  degraded: 'ring-amber-400/30',
  critical: 'ring-red-400/30',
  unknown: 'ring-zinc-500/30',
} as const;

export function CascadeVisualization({ links, signals }: CascadeVisualizationProps) {
  const { t } = useTranslation();
  const signalMap = useMemo(
    () => new Map(signals.map(s => [s.personaId, s])),
    [signals],
  );

  // Group links by chain
  const chains = useMemo(() => {
    if (links.length === 0) return [];

    // Build adjacency list
    const adj = new Map<string, string[]>();
    for (const link of links) {
      const list = adj.get(link.sourcePersonaId) ?? [];
      list.push(link.targetPersonaId);
      adj.set(link.sourcePersonaId, list);
    }

    // Find chain roots (nodes that aren't targets of any link)
    const targets = new Set(links.map(l => l.targetPersonaId));
    const roots = [...new Set(links.map(l => l.sourcePersonaId))].filter(id => !targets.has(id));

    // Walk chains from roots
    const result: string[][] = [];
    for (const root of roots) {
      const chain: string[] = [root];
      let current = root;
      const visited = new Set<string>([root]);
      while (true) {
        const next = adj.get(current)?.[0];
        if (!next || visited.has(next)) break;
        chain.push(next);
        visited.add(next);
        current = next;
      }
      if (chain.length > 1) result.push(chain);
    }

    return result;
  }, [links]);

  if (chains.length === 0 && signals.length > 0) {
    // Show standalone personas in a simple grid
    return (
      <div className="rounded-xl border border-primary/10 bg-secondary/10 p-4">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
            <GitBranch className="w-4 h-4 text-violet-400" />
          </div>
          <div>
            <h3 className="typo-heading text-foreground/90">{t.overview.cascade.title}</h3>
            <p className="text-xs text-muted-foreground/70">{t.overview.cascade.no_chains}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {signals.slice(0, 12).map(s => (
            <div key={s.personaId} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-secondary/40 border border-primary/10">
              <div className={`w-2 h-2 rounded-full ${GRADE_DOT[s.grade]} ring-2 ${GRADE_RING[s.grade]}`} />
              <span className="text-xs text-muted-foreground/80">
                {s.personaIcon && <span className="mr-0.5">{s.personaIcon}</span>}
                {s.personaName}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-primary/10 bg-secondary/10 p-4">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
          <GitBranch className="w-4 h-4 text-violet-400" />
        </div>
        <div>
          <h3 className="typo-heading text-foreground/90">Chain Cascade Map</h3>
          <p className="text-xs text-muted-foreground/70">{chains.length} chain{chains.length !== 1 ? 's' : ''} detected</p>
        </div>
      </div>

      <div className="space-y-3">
        {chains.map((chain, ci) => (
          <div key={ci} className="flex items-center gap-1 overflow-x-auto pb-1">
            {chain.map((personaId, i) => {
              const sig = signalMap.get(personaId);
              if (!sig) return null;

              return (
                <div key={personaId} className="flex items-center gap-1 flex-shrink-0">
                  <ChainNode signal={sig} />
                  {i < chain.length - 1 && (
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/30 flex-shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function ChainNode({ signal }: { signal: PersonaHealthSignal }) {
  const dotColor = GRADE_DOT[signal.grade];
  const ringColor = GRADE_RING[signal.grade];

  return (
    <div className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-secondary/40 border border-primary/10 hover:bg-secondary/60 transition-colors">
      <div className={`w-2.5 h-2.5 rounded-full ${dotColor} ring-2 ${ringColor}`} />
      <div className="min-w-0">
        <p className="typo-caption text-foreground/80 truncate max-w-[80px]">
          {signal.personaIcon && <span className="mr-0.5">{signal.personaIcon}</span>}
          {signal.personaName}
        </p>
        <p className="text-[10px] text-muted-foreground/50">{signal.heartbeatScore}hp</p>
      </div>
    </div>
  );
}
