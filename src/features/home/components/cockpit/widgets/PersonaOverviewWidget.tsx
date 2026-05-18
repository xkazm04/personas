import { useEffect, useMemo, useState } from 'react';
import { Bot, Compass, Orbit, Table } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { useIllustration } from '@/features/plugins/companion/inbox/hooks/useIllustration';
import { firstGrapheme } from '@/features/plugins/companion/inbox/_shared/grapheme';
import type { Persona } from '@/lib/bindings/Persona';

import type { CockpitWidgetProps } from '../widgetRegistry';
import { PersonaOverviewConstellation } from './PersonaOverviewConstellation';
import { PersonaOverviewRoster } from './PersonaOverviewRoster';
import { PersonaOverviewAtelier } from './PersonaOverviewAtelier';

/**
 * Persona overview — prototyping shell.
 *
 * Wraps the baseline + three directional variants behind a tab strip so
 * we can A/B them live in the running cockpit. Once we pick a winner,
 * the tab strip + losers will be deleted and only the winner remains.
 *
 * Variants explore directionally different mental models:
 *   - Baseline   — current flat illustrated grid (the bar we're clearing)
 *   - Constellation — spatial / orbital SVG with stats encoded as size + color
 *   - Roster     — dense data-row scan view (model tier, budget, trust, last-run)
 *   - Atelier    — Twin-Atelier polish pattern (header band + hero card + story)
 *
 * Config still flows through to whichever variant is active:
 *   { "limit": N, "filter": "active" | "all", "variant"?: VariantKey }
 */
type VariantKey = 'baseline' | 'constellation' | 'roster' | 'atelier';

const TABS: { key: VariantKey; label: string; subtitle: string; icon: typeof Bot }[] = [
  { key: 'baseline', label: 'Baseline', subtitle: 'today’s grid', icon: Bot },
  { key: 'constellation', label: 'Constellation', subtitle: 'orbital, visual', icon: Orbit },
  { key: 'roster', label: 'Roster', subtitle: 'data-dense scan', icon: Table },
  { key: 'atelier', label: 'Atelier', subtitle: 'narrative + KPI', icon: Compass },
];

export function PersonaOverviewWidget({ config, title }: CockpitWidgetProps) {
  // Config may pin a variant for ops-style explicit choice; otherwise the
  // local tab state controls. Defaults to baseline so the cockpit looks
  // identical to today's behavior until the user clicks a tab.
  const configVariant = (config?.variant as VariantKey | undefined);
  const [variant, setVariant] = useState<VariantKey>(configVariant ?? 'baseline');

  return (
    <div className="rounded-card border border-foreground/10 bg-foreground/[0.02] h-full flex flex-col min-h-0 overflow-hidden">
      {/* Tab strip — throwaway scaffold, removed in Phase 5 consolidation. */}
      <div className="flex-shrink-0 flex items-center gap-1 px-2 pt-2 pb-1 border-b border-foreground/5 bg-background/40">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = tab.key === variant;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setVariant(tab.key)}
              className={`group relative flex items-center gap-1.5 px-2.5 py-1 rounded-input typo-caption transition-colors ${
                active
                  ? 'bg-primary/10 text-primary border border-primary/20'
                  : 'text-foreground/60 hover:text-foreground/85 hover:bg-foreground/[0.04] border border-transparent'
              }`}
              data-testid={`persona-overview-variant-${tab.key}`}
              aria-pressed={active}
            >
              <Icon className="w-3 h-3" />
              <span className="font-medium">{tab.label}</span>
              <span className="text-foreground/40 hidden md:inline">· {tab.subtitle}</span>
            </button>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {variant === 'baseline' && <PersonaOverviewBaseline config={config} title={title} />}
        {variant === 'constellation' && <PersonaOverviewConstellation config={config} title={title} />}
        {variant === 'roster' && <PersonaOverviewRoster config={config} title={title} />}
        {variant === 'atelier' && <PersonaOverviewAtelier config={config} title={title} />}
      </div>
    </div>
  );
}

/**
 * Baseline — preserved verbatim from pre-prototype so we have an
 * accurate A/B reference. Do not improve it during prototyping; the
 * baseline is the bar variants must clear.
 */
function PersonaOverviewBaseline({ config, title }: CockpitWidgetProps) {
  const limit = (config?.limit as number) ?? 8;
  const filter = ((config?.filter as string) ?? 'active') === 'all' ? 'all' : 'active';

  const { personas, fetchPersonas } = useAgentStore(
    useShallow((s) => ({ personas: s.personas, fetchPersonas: s.fetchPersonas })),
  );
  useEffect(() => {
    if (!personas || personas.length === 0) {
      fetchPersonas().catch(() => {});
    }
  }, [personas, fetchPersonas]);

  const visible = useMemo(() => {
    const arr = personas ?? [];
    const filtered = filter === 'active' ? arr.filter((p) => p.enabled !== false) : arr;
    return filtered.slice(0, limit);
  }, [personas, filter, limit]);

  const openPersona = (id: string) => {
    const sys = useSystemStore.getState();
    sys.setSidebarSection('personas');
    useAgentStore.getState().selectPersona(id);
  };

  return (
    <div className="h-full flex flex-col min-h-0 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="typo-caption text-foreground/60 uppercase tracking-wide">
          {title ?? 'Your personas'}
        </div>
        <div className="typo-caption text-foreground/40">
          {visible.length} of {personas?.length ?? 0}
        </div>
      </div>
      {visible.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-foreground/40">
          <Bot className="w-6 h-6" />
          <div className="typo-caption">No personas yet</div>
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 overflow-y-auto auto-rows-min">
          {visible.map((p) => (
            <PersonaTile key={p.id} persona={p} onOpen={openPersona} />
          ))}
        </div>
      )}
    </div>
  );
}

function PersonaTile({
  persona,
  onOpen,
}: {
  persona: Persona;
  onOpen: (id: string) => void;
}) {
  const illustration = useIllustration(persona);
  const initial = firstGrapheme(persona.icon ?? persona.name ?? '?');
  return (
    <button
      type="button"
      onClick={() => onOpen(persona.id)}
      className="group relative flex flex-col items-start gap-1 rounded-card border border-foreground/10 bg-background/40 p-2 text-left hover:border-foreground/25 hover:bg-foreground/[0.04] transition-colors"
    >
      <div
        className="w-full aspect-[4/3] rounded-input bg-cover bg-center"
        style={{ backgroundImage: `url(${illustration.url})` }}
        aria-hidden
      />
      <div className="flex items-center gap-1.5 w-full">
        <span className="typo-caption shrink-0" aria-hidden>
          {initial}
        </span>
        <span className="typo-caption truncate text-foreground/85">{persona.name}</span>
      </div>
    </button>
  );
}
