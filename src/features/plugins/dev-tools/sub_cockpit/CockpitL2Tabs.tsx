// R14 — CONSOLIDATION TRIAL. The R13 Module bar mirrored the real Factory L2
// (Overview | KPIs | Context map | Observability); this round merges the first
// THREE into one consolidated surface (CockpitConsolidated): the Focus grid
// carries the context-map coverage and the KPI proposals as card indicators,
// and the toolbar aggregates every scan. Two card/toolbar variants (Deck /
// Inline) sit behind the bench switcher per /prototype. Observability stays a
// separate tab — the technical dimension wasn't part of this consolidation.
import { useState } from 'react';
import { Activity, AlertTriangle, CircleDollarSign } from 'lucide-react';

import { InkTabs, NEON, SETUP_BLUE } from './cockpitGlyphs';
import type { MockProject } from './cockpitMock';
import { OBS_BY_PROJECT } from './cockpitL2Mock';
import CockpitConsolidated, { type ConsolidatedVariant } from './CockpitConsolidated';

type L2Tab = 'overview' | 'observability';

const TABS: Array<{ id: L2Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'observability', label: 'Observability' },
];

const VARIANTS: Array<{ id: ConsolidatedVariant; label: string }> = [
  { id: 'deck', label: 'Deck' },
  { id: 'inline', label: 'Inline' },
];

export default function CockpitL2Tabs({ project }: { project: MockProject }) {
  const [tab, setTab] = useState<L2Tab>('overview');
  const [variant, setVariant] = useState<ConsolidatedVariant>('deck');
  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="cockpit-l2-tabs">
      <div className="mx-5 mt-3 flex items-center justify-between gap-4 flex-wrap">
        <InkTabs tabs={TABS} active={tab} onChange={setTab} label="Module" />
        {tab === 'overview' && (
          <InkTabs tabs={VARIANTS} active={variant} onChange={setVariant} label="Variant" />
        )}
      </div>
      {tab === 'overview' && <CockpitConsolidated project={project} variant={variant} />}
      {tab === 'observability' && <div className="mx-5 mt-3 pb-8 overflow-y-auto"><ObservabilityTab project={project} /></div>}
    </div>
  );
}

// ── Observability — mirrors FactoryObservabilityTab (LLM + Monitoring mix) ────

function ObservabilityTab({ project }: { project: MockProject }) {
  const obs = OBS_BY_PROJECT[project.id] ?? { features: null, issues: null };
  const totalCost = (obs.features ?? []).reduce((s, f) => s + f.costUsd, 0);
  const totalEvents = (obs.issues ?? []).reduce((s, i) => s + i.count, 0);
  const maxCost = obs.features?.[0]?.costUsd ?? 0;
  const maxEvents = obs.issues ? Math.max(...obs.issues.map((i) => i.count), 0) : 0;

  const panel = (title: string, icon: React.ReactNode, hue: string, body: React.ReactNode) => (
    <section className="rounded-xl p-3.5 min-w-0" style={{ border: '1px solid rgba(148,163,184,.14)', background: 'rgba(148,163,184,.025)' }}>
      <h3 className="flex items-center gap-2 mb-2.5">
        <span style={{ color: hue }}>{icon}</span>
        <span className="text-[10.5px] uppercase tracking-[0.14em] text-foreground/55">{title}</span>
      </h3>
      {body}
    </section>
  );
  const ask = (what: string) => (
    <p className="typo-caption rounded-card border border-dashed px-3 py-4 text-center" style={{ color: SETUP_BLUE, borderColor: `${SETUP_BLUE}55`, background: `${SETUP_BLUE}0a` }}>
      {what} is not wired — bind a connector on the project to light this panel.
    </p>
  );

  return (
    <div className="grid gap-3 items-start" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }} data-testid="cockpit-observability-tab">
      {panel('LLM — spend by feature · 30d', <CircleDollarSign className="w-4 h-4" aria-hidden />, NEON.teal,
        !obs.features ? ask('LLM tracking') : (
          <>
            <p className="typo-caption text-foreground/55 mb-2 tabular-nums">${totalCost.toFixed(2)} across {obs.features.length} features</p>
            <ul className="space-y-1.5">
              {obs.features.map((f) => {
                const heavy = f.costUsd >= 18 ? NEON.red : f.costUsd >= 6 ? NEON.amber : NEON.emerald;
                return (
                  <li key={f.name} className="min-w-0">
                    <span className="flex items-baseline gap-2 min-w-0">
                      <span className="typo-caption text-foreground/85 truncate">{f.name}</span>
                      <span className="text-[10px] text-foreground/40 shrink-0">{f.calls.toLocaleString()} calls · {f.model}</span>
                      <span className="typo-caption tabular-nums font-medium ml-auto shrink-0" style={{ color: heavy }}>${f.costUsd.toFixed(2)}</span>
                    </span>
                    <span className="block h-[2px] rounded-full mt-1" style={{ background: 'rgba(148,163,184,.10)' }}>
                      <span className="block h-full rounded-full" style={{ width: `${maxCost > 0 ? (f.costUsd / maxCost) * 100 : 0}%`, background: heavy }} />
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        ),
      )}
      {panel('Monitoring — unresolved errors', <Activity className="w-4 h-4" aria-hidden />, NEON.red,
        !obs.issues ? ask('Monitoring') : obs.issues.length === 0 ? (
          <p className="typo-caption py-3 text-center" style={{ color: NEON.emerald }}>No unresolved issues — clear.</p>
        ) : (
          <>
            <p className="typo-caption text-foreground/55 mb-2 tabular-nums">{totalEvents} events across {obs.issues.length} unresolved issues</p>
            <ul className="space-y-1.5">
              {obs.issues.map((i) => {
                const heavy = i.count >= 25 ? NEON.red : NEON.amber;
                return (
                  <li key={i.title} className="min-w-0">
                    <span className="flex items-baseline gap-2 min-w-0">
                      <AlertTriangle className="w-3 h-3 shrink-0 self-center" style={{ color: heavy }} aria-hidden />
                      <span className="typo-caption text-foreground/85 truncate" title={i.title}>{i.title}</span>
                      <span className="typo-caption tabular-nums font-medium ml-auto shrink-0" style={{ color: heavy }}>{i.count}</span>
                    </span>
                    {i.culprit && <span className="block text-[10px] text-foreground/40 truncate pl-5">{i.culprit}</span>}
                    <span className="block h-[2px] rounded-full mt-1" style={{ background: 'rgba(148,163,184,.10)' }}>
                      <span className="block h-full rounded-full" style={{ width: `${maxEvents > 0 ? (i.count / maxEvents) * 100 : 0}%`, background: heavy }} />
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        ),
      )}
    </div>
  );
}
