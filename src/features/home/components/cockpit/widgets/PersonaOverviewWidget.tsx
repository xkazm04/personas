import { useEffect, useMemo } from 'react';
import { Bot } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { useIllustration } from '@/features/plugins/companion/inbox/hooks/useIllustration';
import { firstGrapheme } from '@/features/plugins/companion/inbox/_shared/grapheme';
import type { Persona } from '@/lib/bindings/Persona';

import type { CockpitWidgetProps } from '../widgetRegistry';

/**
 * Persona overview — illustrated card grid. Click a card to navigate to
 * Agents → that persona.
 *
 * Config:
 *   { "limit": N, "filter": "active" | "all" }
 */
export function PersonaOverviewWidget({ config, title }: CockpitWidgetProps) {
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
    <div className="rounded-card border border-foreground/10 bg-foreground/[0.02] p-4 h-full flex flex-col min-h-0">
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
