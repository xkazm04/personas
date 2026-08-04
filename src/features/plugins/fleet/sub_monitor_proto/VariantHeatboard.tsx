import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { MoonStar } from 'lucide-react';
import { STATE_ICON, stateMeta, TerminalStats, CostMeter } from './monitorProtoMeta';
import type { ProtoTerminal } from './mockFleet';

/**
 * Variant 1 — HEATBOARD. Metaphor: a server rack seen from the front.
 *
 * Every terminal is a small fixed-height chip in a dense auto-fill grid,
 * grouped by project. Colour = lifecycle state (the fleet palette), the
 * bottom edge is a resource-cost meter, and the three stats ride as a
 * micro-row. 50 chips fit one screen with zero scrolling on a 1080p window;
 * the eye scans colour first, cost second, names last.
 */
export function VariantHeatboard({
  fleet, onOpen,
}: {
  fleet: ProtoTerminal[];
  onOpen: (t: ProtoTerminal) => void;
}) {
  const byProject = useMemo(() => {
    const m = new Map<string, ProtoTerminal[]>();
    for (const t of fleet) {
      const list = m.get(t.project) ?? [];
      list.push(t);
      m.set(t.project, list);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [fleet]);

  return (
    <div className="h-full overflow-auto px-4 py-3 space-y-4">
      {byProject.map(([project, terms]) => (
        <section key={project}>
          <div className="flex items-center gap-2 mb-1.5">
            <h3 className="typo-label uppercase tracking-wide text-foreground opacity-60">{project}</h3>
            <span className="typo-caption text-foreground opacity-40 font-data">{terms.length}</span>
            <div className="flex-1 h-px bg-primary/10" />
          </div>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))' }}>
            {terms.map((t) => {
              const meta = stateMeta(t.state);
              const Icon = STATE_ICON[t.state];
              return (
                <motion.button
                  key={t.id}
                  layoutId={`proto-term-${t.id}`}
                  type="button"
                  onClick={() => onOpen(t)}
                  className={`group text-left rounded-card border bg-secondary/20 hover:bg-secondary/40 transition-colors overflow-hidden ${
                    t.state === 'awaiting_input' ? 'border-violet-400/50' : 'border-primary/10 hover:border-primary/30'
                  }`}
                  title={`${t.label} — ${t.state}`}
                >
                  <div className="px-2 pt-1.5 flex items-center gap-1.5 min-w-0">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`} aria-hidden="true" />
                    <Icon className={`w-3 h-3 shrink-0 ${meta.text}`} aria-hidden="true" />
                    <span className="typo-caption text-foreground truncate flex-1 min-w-0">{t.label}</span>
                    {t.dozing && <MoonStar className="w-3 h-3 shrink-0 text-indigo-300" aria-hidden="true" />}
                  </div>
                  <div className="px-2 py-1">
                    <TerminalStats t={t} />
                  </div>
                  <CostMeter t={t} />
                </motion.button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
