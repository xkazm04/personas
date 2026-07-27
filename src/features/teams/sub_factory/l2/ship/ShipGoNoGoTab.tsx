// Ship variant 3 — GO/NO-GO. The certification metaphor: a launch poll. Each
// exit criterion is a STATION that votes GO / NO-GO / HOLD / WIRE from derived
// evidence; the board's verdict is the worst vote, and "Certify ship" only
// arms when every station reads GO. Austere, data-dense, uppercase-tracked —
// the Factory's ink language at its most ceremonial. Features never appear
// here as a list: this surface certifies, the other layers build.
import { motion, useReducedMotion } from 'framer-motion';
import { Gauge, Layers, Radio, Rocket, ShieldCheck } from 'lucide-react';

import { INK, SegBar } from '../../passport/passportInk';
import {
  CRIT_HUE, MOCK_MILESTONE, coreFeatures, shipProgress, shipVerdict,
  type CritKind, type CritState,
} from './shipModel';

const VOTE: Record<CritState, string> = { go: 'GO', warn: 'HOLD', nogo: 'NO-GO', setup: 'WIRE' };
const KIND_ICON: Record<CritKind, typeof Gauge> = {
  verify: ShieldCheck, contexts: Layers, kpi: Gauge, passport: Radio,
};

export function ShipGoNoGoTab() {
  const reduce = useReducedMotion();
  const m = MOCK_MILESTONE;
  const verdict = shipVerdict(m);
  const open = m.criteria.filter((c) => c.state !== 'go').length;
  const progress = shipProgress(m);
  const core = coreFeatures(m);
  const hue = CRIT_HUE[verdict];

  return (
    <div data-testid="factory-ship-gonogo">
      {/* the poll plaque */}
      <div
        className="rounded-card px-4 py-3 mb-3 flex items-center gap-4 flex-wrap"
        style={{ border: `1px solid ${hue}3a`, background: `${hue}08` }}
      >
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.16em] text-foreground/40">Launch poll · {m.name}</p>
          <p className="typo-caption text-foreground/70 max-w-lg truncate" title={m.goal}>{m.goal}</p>
        </div>
        <div className="ml-auto flex items-center gap-5 shrink-0">
          <div className="text-right">
            <span className="text-[10px] uppercase tracking-[0.12em] text-foreground/40 block">Core build</span>
            <span className="typo-caption tabular-nums text-foreground/80">{progress}% · {core.length} features</span>
          </div>
          <div className="text-right">
            <span className="text-[10px] uppercase tracking-[0.12em] text-foreground/40 block">
              {open > 0 ? `T-minus ${open} ${open === 1 ? 'station' : 'stations'}` : 'All stations polled'}
            </span>
            <span className="text-lg font-semibold tracking-[0.08em] tabular-nums" style={{ color: hue, textShadow: `0 0 12px ${hue}55` }}>
              {VOTE[verdict]}
            </span>
          </div>
        </div>
      </div>

      {/* the stations */}
      <ul className="rounded-card border border-foreground/[0.07] overflow-hidden" style={{ background: 'rgba(148,163,184,.02)' }}>
        {m.criteria.map((c, i) => {
          const cHue = CRIT_HUE[c.state];
          const go = c.state === 'go';
          const Icon = KIND_ICON[c.kind];
          return (
            <motion.li
              key={c.id}
              className={`flex items-center gap-3.5 px-3.5 py-2.5 border-b border-foreground/[0.05] last:border-0 min-w-0 ${go ? 'opacity-55' : ''}`}
              initial={reduce ? false : { opacity: 0, x: -8 }}
              animate={{ opacity: go ? 0.55 : 1, x: 0 }}
              transition={{ delay: i * 0.09, duration: 0.3 }}
              data-testid={`ship-station-${c.id}`}
            >
              <span className="flex items-center gap-2.5 w-7 shrink-0">
                <span className="text-[10px] tabular-nums text-foreground/30">{String(i + 1).padStart(2, '0')}</span>
                <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: go ? 'rgba(148,163,184,.6)' : cHue }} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="typo-caption font-medium text-foreground/90 block truncate">{c.label}</span>
                <span className="typo-caption text-foreground/50 block truncate">{c.evidence}</span>
              </span>
              <span className="w-24 shrink-0 hidden sm:block">
                <SegBar steps={c.total} reached={c.done} hue={cHue} faded={go} />
                <span className="text-[10px] tabular-nums text-foreground/40 block mt-0.5 text-right">{c.done}/{c.total}</span>
              </span>
              {!go && c.dispatch && (
                <button
                  type="button"
                  className="shrink-0 text-[10.5px] font-medium px-2 py-1 rounded-interactive border transition-colors hover:bg-foreground/[0.05] focus-ring"
                  style={{ color: INK.blue, borderColor: `${INK.blue}55` }}
                  title="Dispatch a fleet session at this gap"
                >
                  {c.dispatch} →
                </button>
              )}
              <span
                className="w-14 shrink-0 text-right text-[11px] font-semibold tracking-[0.1em] tabular-nums"
                style={{ color: cHue, textShadow: go ? undefined : `0 0 8px ${cHue}44` }}
              >
                {VOTE[c.state]}
              </span>
            </motion.li>
          );
        })}
      </ul>

      {/* the ritual endpoint — armed only on all-GO */}
      <div className="flex items-center gap-3 mt-3">
        <button
          type="button"
          disabled={verdict !== 'go'}
          className="inline-flex items-center gap-1.5 rounded-card px-3 py-1.5 typo-caption font-semibold transition-colors focus-ring disabled:opacity-40"
          style={{ color: INK.emerald, border: `1px solid ${INK.emerald}66` }}
          title={verdict === 'go' ? 'Certify the milestone and hand off to KPI operation' : 'Every station must read GO'}
          data-testid="ship-certify"
        >
          <Rocket className="w-3.5 h-3.5" aria-hidden />
          Certify ship
        </button>
        <p className="typo-caption text-foreground/40">
          Certification closes the milestone and flips this project into operate mode — the KPI module takes over as the default surface.
        </p>
      </div>
    </div>
  );
}
