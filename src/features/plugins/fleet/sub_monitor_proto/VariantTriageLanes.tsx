import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { MoonStar } from 'lucide-react';
import {
  STATE_ICON, stateMeta, TerminalStats, CostMeter,
  attentionLane, LANE_ORDER, LANE_LABEL, type AttentionLane,
} from './monitorProtoMeta';
import type { ProtoTerminal } from './mockFleet';

const LANE_TONE: Record<AttentionLane, string> = {
  needs_you: 'text-violet-300',
  working: 'text-blue-300',
  parked: 'text-emerald-300',
  done: 'text-foreground opacity-50',
};

/**
 * Variant 2 — TRIAGE LANES. Metaphor: an air-traffic-control board.
 *
 * Terminals are sorted into four attention lanes — Needs you / Working /
 * Parked / Done — in that fixed order, so the operator's (or Athena's) scan
 * path is always "top lane first". Cards are wide and one line tall; the
 * "Needs you" lane is the only place the eye must stop. Lane membership IS
 * the state machine, so colour becomes secondary information.
 */
export function VariantTriageLanes({
  fleet, onOpen,
}: {
  fleet: ProtoTerminal[];
  onOpen: (t: ProtoTerminal) => void;
}) {
  const lanes = useMemo(() => {
    const m: Record<AttentionLane, ProtoTerminal[]> = { needs_you: [], working: [], parked: [], done: [] };
    for (const t of fleet) m[attentionLane(t)].push(t);
    m.needs_you.sort((a, b) => b.ageMin - a.ageMin);
    m.working.sort((a, b) => b.subagentsActive - a.subagentsActive);
    return m;
  }, [fleet]);

  return (
    <div className="h-full overflow-auto px-4 py-3 space-y-4">
      {LANE_ORDER.map((lane) => {
        const terms = lanes[lane];
        if (terms.length === 0) return null;
        const emphasized = lane === 'needs_you';
        return (
          <section key={lane}>
            <div className="flex items-center gap-2 mb-1.5">
              <h3 className={`typo-label uppercase tracking-wide ${LANE_TONE[lane]}`}>{LANE_LABEL[lane]}</h3>
              <span className="typo-caption text-foreground opacity-40 font-data">{terms.length}</span>
              <div className="flex-1 h-px bg-primary/10" />
            </div>
            <div className={`grid gap-1.5 ${emphasized ? '' : ''}`} style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
              {terms.map((t) => {
                const meta = stateMeta(t.state);
                const Icon = STATE_ICON[t.state];
                return (
                  <motion.button
                    key={t.id}
                    layoutId={`proto-term-${t.id}`}
                    type="button"
                    onClick={() => onOpen(t)}
                    className={`text-left rounded-card border overflow-hidden transition-colors ${
                      emphasized
                        ? 'border-violet-400/40 bg-violet-500/[0.06] hover:bg-violet-500/[0.12]'
                        : 'border-primary/10 bg-secondary/20 hover:bg-secondary/40 hover:border-primary/25'
                    }`}
                  >
                    <div className={`flex items-center gap-2 px-2.5 min-w-0 ${emphasized ? 'py-2' : 'py-1.5'}`}>
                      <Icon className={`w-3.5 h-3.5 shrink-0 ${meta.text}`} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-foreground ${emphasized ? 'typo-body font-medium' : 'typo-caption'}`}>
                          {t.label}
                        </span>
                        <span className="block typo-caption text-foreground opacity-45 truncate">
                          {t.project}
                          {emphasized && t.ageMin > 0 ? ` · waiting ${t.ageMin}m` : ''}
                        </span>
                      </span>
                      {t.dozing && <MoonStar className="w-3 h-3 shrink-0 text-indigo-300" aria-hidden="true" />}
                      <TerminalStats t={t} className="shrink-0" />
                    </div>
                    <CostMeter t={t} />
                  </motion.button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
