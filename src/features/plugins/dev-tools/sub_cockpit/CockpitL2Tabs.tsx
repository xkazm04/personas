// R13 — the bench's PROJECT LEVEL, synced to the real Factory L2 structure:
// Module: Overview | KPIs | Context map | Observability (Overview first +
// default, same as Factory after R13) — but populated with MOCK data so every
// tab can be judged fully lit. Each tab mirrors its Factory counterpart's
// composition (same headers, same table columns, same panels); actions that
// would hit real APIs are stubbed with a note.
import { useMemo, useState } from 'react';
import { AlertTriangle, Activity, Cable, Check, CircleDollarSign, Layers, RefreshCw, Sparkles, X } from 'lucide-react';

import { BaseModal } from '@/features/shared/components/modals';

import { InkTabs, NEON, SETUP_BLUE } from './cockpitGlyphs';
import { cellStats, gridFor, type MockContextCell, type MockProject } from './cockpitMock';
import {
  ACTIVE_KPI_COUNT, OBS_BY_PROJECT, PROPOSALS_BY_PROJECT, mockFeatureCount,
  type MockProposal,
} from './cockpitL2Mock';
import CockpitFocus from './CockpitFocus';

type L2Tab = 'overview' | 'kpis' | 'context' | 'observability';

const TABS: Array<{ id: L2Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'kpis', label: 'KPIs' },
  { id: 'context', label: 'Context map' },
  { id: 'observability', label: 'Observability' },
];

const CATEGORY_HUE: Record<MockProposal['category'], string> = {
  technical: NEON.violet, traffic: NEON.teal, value: NEON.emerald, quality: NEON.amber,
};

export default function CockpitL2Tabs({ project }: { project: MockProject }) {
  const [tab, setTab] = useState<L2Tab>('overview');
  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="cockpit-l2-tabs">
      <div className="mx-5 mt-3">
        <InkTabs tabs={TABS} active={tab} onChange={setTab} label="Module" />
      </div>
      {tab === 'overview' && <CockpitFocus project={project} />}
      {tab === 'kpis' && <div className="mx-5 mt-3 pb-8 overflow-y-auto"><KpisTab project={project} /></div>}
      {tab === 'context' && <div className="mx-5 mt-3 pb-8 overflow-y-auto"><ContextTab project={project} /></div>}
      {tab === 'observability' && <div className="mx-5 mt-3 pb-8 overflow-y-auto"><ObservabilityTab project={project} /></div>}
    </div>
  );
}

// ── KPIs — mirrors FactoryKpisTab (dense proposals table + detail modal) ─────

function KpisTab({ project }: { project: MockProject }) {
  const [decided, setDecided] = useState<Record<string, 'accepted' | 'rejected'>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const proposals = useMemo(
    () => (PROPOSALS_BY_PROJECT[project.id] ?? []).filter((p) => !decided[p.id]),
    [project.id, decided],
  );
  const open = proposals.find((p) => p.id === openId) ?? null;
  const activeCount = (ACTIVE_KPI_COUNT[project.id] ?? 0) + Object.values(decided).filter((d) => d === 'accepted').length;

  const decide = (p: MockProposal, verdict: 'accepted' | 'rejected') => {
    setDecided((d) => ({ ...d, [p.id]: verdict }));
    setOpenId(null);
  };

  const num = (v: number | null, unit: string) =>
    v == null ? <span className="text-foreground/35">—</span> : <span className="tabular-nums">{v} <span className="text-foreground/45">{unit}</span></span>;

  return (
    <div data-testid="cockpit-kpis-tab">
      <div className="flex items-center gap-3 mb-2">
        <h3 className="text-[10.5px] uppercase tracking-[0.14em] text-foreground/50">Proposals</h3>
        <span className="text-[11px] tabular-nums text-foreground/40">{proposals.length} proposed · {activeCount} active</span>
        <button
          type="button"
          onClick={() => setNote('prototype — the scan runs in the real Factory')}
          className="ml-auto inline-flex items-center gap-1.5 rounded-card px-2.5 py-1 typo-caption font-medium transition-colors focus-ring hover:bg-foreground/[0.05]"
          style={{ color: NEON.teal, border: `1px solid ${NEON.teal}55` }}
        >
          <Sparkles className="w-3.5 h-3.5" aria-hidden />
          Scan for KPIs
        </button>
      </div>
      {note && <p className="typo-caption text-foreground/45 mb-2">{note}</p>}

      {proposals.length === 0 ? (
        <p className="typo-caption text-foreground/45 rounded-card border border-dashed border-foreground/15 px-3 py-4 text-center">
          No proposals waiting — scan to let the app propose KPIs from the context map.
        </p>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(148,163,184,.14)', background: 'rgba(148,163,184,.025)' }}>
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left border-b border-foreground/10">
                <th className="text-[10px] uppercase tracking-[0.12em] text-foreground/45 font-medium px-3 py-2">KPI</th>
                <th className="text-[10px] uppercase tracking-[0.12em] text-foreground/45 font-medium px-3 py-2 text-right">Baseline</th>
                <th className="text-[10px] uppercase tracking-[0.12em] text-foreground/45 font-medium px-3 py-2 text-right">Target</th>
                <th className="w-px px-3 py-2" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {proposals.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => setOpenId(p.id)}
                  className="border-b border-foreground/[0.05] hover:bg-foreground/[0.04] cursor-pointer transition-colors"
                  data-testid={`cockpit-kpi-proposal-${p.id}`}
                >
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: CATEGORY_HUE[p.category] }} title={p.category} />
                      <span className="typo-caption font-medium text-foreground truncate">{p.name}</span>
                      {p.neededConnector && (
                        <span className="inline-flex items-center gap-1 text-[10.5px] shrink-0" style={{ color: SETUP_BLUE }} title={`Needs the ${p.neededConnector} connector`}>
                          <Cable className="w-3 h-3" aria-hidden />
                          {p.neededConnector}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2 typo-caption text-foreground/85 text-right">{num(p.baseline, p.unit)}</td>
                  <td className="px-3 py-2 typo-caption text-foreground/85 text-right">{num(p.target, p.unit)}</td>
                  <td className="px-3 py-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <span className="flex items-center gap-1 justify-end">
                      <button type="button" onClick={() => decide(p, 'rejected')} aria-label="Reject" title="Reject" className="p-1 rounded-interactive hover:bg-red-400/15 transition-colors focus-ring">
                        <X className="w-3.5 h-3.5" style={{ color: NEON.red }} aria-hidden />
                      </button>
                      <button type="button" onClick={() => decide(p, 'accepted')} aria-label="Accept" title="Accept" className="p-1 rounded-interactive hover:bg-emerald-400/15 transition-colors focus-ring">
                        <Check className="w-3.5 h-3.5" style={{ color: NEON.emerald }} aria-hidden />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && <ProposalModal p={open} onDecide={decide} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function ProposalModal({ p, onDecide, onClose }: {
  p: MockProposal;
  onDecide: (p: MockProposal, verdict: 'accepted' | 'rejected') => void;
  onClose: () => void;
}) {
  const [target, setTarget] = useState(p.target != null ? String(p.target) : '');
  const hue = CATEGORY_HUE[p.category];
  const line = (label: string, value: React.ReactNode) => (
    <div className="flex gap-3 py-1.5 border-b border-foreground/[0.05] last:border-0">
      <span className="text-[10px] uppercase tracking-[0.12em] text-foreground/40 w-24 shrink-0 pt-0.5">{label}</span>
      <span className="typo-caption text-foreground/85 min-w-0">{value}</span>
    </div>
  );
  return (
    <BaseModal isOpen onClose={onClose} titleId="cockpit-kpi-proposal-title" size="md" portal>
      <div className="px-1" data-testid="cockpit-kpi-proposal-modal">
        <h2 id="cockpit-kpi-proposal-title" className="typo-body font-semibold text-foreground mb-2">{p.name}</h2>
        <div className="flex items-center gap-2 mb-3">
          <span className="rounded-full px-2 py-[2px] text-[10px] font-medium tracking-wide" style={{ color: hue, border: `1px solid ${hue}55`, background: `${hue}14` }}>
            {p.category}
          </span>
          <span className="text-[10.5px] text-foreground/45">{p.cadence} · {p.measureKind}</span>
          {p.neededConnector && (
            <span className="inline-flex items-center gap-1 text-[10.5px]" style={{ color: SETUP_BLUE }}>
              <Cable className="w-3 h-3" aria-hidden /> needs {p.neededConnector}
            </span>
          )}
        </div>
        {line('What', p.description)}
        {line('Why', p.rationale)}
        {line('Procedure', p.procedure)}
        {line('Baseline', p.baseline != null ? `${p.baseline} ${p.unit}` : '—')}
        {line('Direction', p.direction === 'down' ? 'lower is better' : 'higher is better')}
        {line(
          'Target',
          <span className="inline-flex items-center gap-1.5">
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              inputMode="decimal"
              className="w-24 bg-transparent border rounded-input px-2 py-0.5 typo-caption tabular-nums text-foreground focus-ring"
              style={{ borderColor: 'rgba(148,163,184,.3)' }}
              aria-label="Adjust target"
            />
            <span className="text-foreground/45">{p.unit}</span>
          </span>,
        )}
        <div className="flex items-center gap-2 mt-4 mb-1">
          <button
            type="button"
            onClick={() => onDecide(p, 'rejected')}
            className="inline-flex items-center gap-1.5 rounded-card px-3 py-1.5 typo-caption font-medium transition-colors focus-ring hover:bg-red-400/10"
            style={{ color: NEON.red, border: `1px solid ${NEON.red}55` }}
          >
            <X className="w-3.5 h-3.5" aria-hidden /> Reject
          </button>
          <button
            type="button"
            onClick={() => onDecide(p, 'accepted')}
            className="ml-auto inline-flex items-center gap-1.5 rounded-card px-3 py-1.5 typo-caption font-semibold transition-colors focus-ring hover:bg-emerald-400/10"
            style={{ color: NEON.emerald, border: `1px solid ${NEON.emerald}55` }}
          >
            <Check className="w-3.5 h-3.5" aria-hidden /> Accept
          </button>
        </div>
      </div>
    </BaseModal>
  );
}

// ── Context map — mirrors FactoryContextTab (groups → plates + scans) ─────────

const KPI_TONE_HUE: Record<MockContextCell['dims']['kpi'], string> = {
  crit: NEON.red, warn: NEON.amber, ok: NEON.emerald, unmeasured: 'rgba(148,163,184,.45)',
};

function ContextTab({ project }: { project: MockProject }) {
  const [note, setNote] = useState<string | null>(null);
  const groups = gridFor(project);
  const total = groups.reduce((s, g) => s + g.cells.length, 0);
  const features = groups.reduce((s, g) => s + g.cells.reduce((x, c) => x + mockFeatureCount(c.id), 0), 0);

  const scanButtons = (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => setNote('prototype — the codebase scan runs in the real Factory')}
        className="inline-flex items-center gap-1.5 rounded-card px-2.5 py-1 typo-caption font-medium transition-colors focus-ring hover:bg-foreground/[0.05]"
        style={{ color: NEON.teal, border: `1px solid ${NEON.teal}55` }}
      >
        <RefreshCw className="w-3.5 h-3.5" aria-hidden />
        {total > 0 ? 'Rescan codebase' : 'Scan codebase'}
      </button>
      <button
        type="button"
        onClick={() => setNote('prototype — the feature scan runs in the real Factory')}
        className="inline-flex items-center gap-1.5 rounded-card px-2.5 py-1 typo-caption font-medium transition-colors focus-ring hover:bg-foreground/[0.05]"
        style={{ color: NEON.violet, border: `1px solid ${NEON.violet}55` }}
      >
        <Sparkles className="w-3.5 h-3.5" aria-hidden />
        Scan features
      </button>
    </span>
  );

  if (total === 0) {
    return (
      <div className="rounded-card border border-dashed border-foreground/15 px-3 py-5 text-center" data-testid="cockpit-context-tab">
        <p className="typo-caption text-foreground/45 mb-3">No context map yet — scan the codebase to build it.</p>
        {scanButtons}
        {note && <p className="typo-caption text-foreground/55 mt-2">{note}</p>}
      </div>
    );
  }

  return (
    <div data-testid="cockpit-context-tab">
      <div className="flex items-center gap-3 flex-wrap mb-2.5">
        <p className="typo-caption text-foreground/45 min-w-0">
          {total} contexts · {groups.length} groups · {features} features — tinted by KPI health.
        </p>
        <span className="ml-auto shrink-0">{scanButtons}</span>
      </div>
      {note && <p className="typo-caption text-foreground/55 mb-2">{note}</p>}
      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' }}>
        {groups.map((g) => {
          const tones = g.cells.map((c) => c.dims.kpi);
          const worst = tones.includes('crit') ? NEON.red : tones.includes('warn') ? NEON.amber : tones.includes('ok') ? NEON.emerald : 'rgba(148,163,184,.45)';
          return (
            <div key={g.id} className="rounded-xl p-3" style={{ border: `1px solid ${worst}2e`, background: 'rgba(148,163,184,.025)' }}>
              <div className="flex items-baseline gap-2 mb-2 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full shrink-0 self-center" style={{ background: worst, boxShadow: `0 0 5px ${worst}66` }} />
                <span className="typo-caption font-semibold tracking-tight text-foreground/85 truncate">{g.name}</span>
                <span className="ml-auto text-[10px] tabular-nums text-foreground/35 shrink-0">{g.cells.length}</span>
              </div>
              <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))' }}>
                {g.cells.map((c) => {
                  const s = cellStats(c);
                  const hue = KPI_TONE_HUE[c.dims.kpi];
                  const neutral = c.dims.kpi === 'unmeasured';
                  return (
                    <div
                      key={c.id}
                      className="min-w-0 px-2.5 pt-1.5 pb-2 rounded-lg"
                      style={{
                        background: neutral ? 'rgba(148,163,184,.04)' : `${hue}0d`,
                        border: `1px solid ${neutral ? 'rgba(148,163,184,.16)' : `${hue}3d`}`,
                      }}
                      title={c.name}
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: hue, boxShadow: neutral ? undefined : `0 0 5px ${hue}88` }} />
                        <span className="typo-caption font-medium text-foreground/90 truncate">{c.short}</span>
                      </span>
                      <span className="flex items-center gap-2.5 mt-1.5 min-w-0 text-[10.5px] tabular-nums">
                        <span className="flex items-center gap-1" style={{ color: s.errs != null ? (s.errs >= 25 ? NEON.red : s.errs > 0 ? NEON.amber : NEON.emerald) : 'rgba(148,163,184,.4)' }}>
                          <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden />
                          {s.errs ?? '·'}
                        </span>
                        <span className="flex items-center gap-1" style={{ color: s.costUsd != null ? (s.costUsd >= 18 ? NEON.red : s.costUsd >= 6 ? NEON.amber : NEON.emerald) : 'rgba(148,163,184,.4)' }}>
                          <CircleDollarSign className="w-3 h-3 shrink-0" aria-hidden />
                          {s.costUsd ?? '·'}
                        </span>
                        <span className="flex items-center gap-1 text-foreground/45 ml-auto">
                          <Layers className="w-3 h-3 shrink-0" aria-hidden />
                          {mockFeatureCount(c.id)}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
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
