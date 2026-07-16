// R15 — the CONSOLIDATION WINNER (R14 verdict: Inline cards + Deck toolbar).
// One surface = the Focus health grid carrying the context-map coverage and
// the KPI proposals as in-card indicators:
//   Layers = features · Target = goals · Gauge = proposed KPIs · Sparkles =
//   per-context scan. The Gauge tooltip is the as-is proposals table (same
//   KPI/Baseline/Target columns) — now INTERACTIVE, with the review queue's
//   accept/reject icons on every row (hover-persistent portal).
// The toolbar keeps the exploded Deck layout: one ink button per scan —
// Scan KPIs · Scan features · Re-scan contexts (delta) · Full scan.
// Mirrors the real Factory consolidated tab 1:1; actions are mock/stubbed.
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle, Cable, Check, CircleDollarSign, Gauge, Layers,
  RefreshCw, ScanSearch, Sparkles, Target, Wrench, X,
} from 'lucide-react';

import { GhostGrid, GridMasthead, NEON, SETUP_BLUE, anchorTip } from './cockpitGlyphs';
import {
  cellStats, gridFor, dominantTone,
  type CellStats, type MockContextCell, type MockProject,
} from './cockpitMock';
import {
  mockFeatureCount, mockGoalCount, mockProposalsForCell,
  type MockProposal,
} from './cockpitL2Mock';

const CATEGORY_HUE: Record<MockProposal['category'], string> = {
  technical: NEON.violet, traffic: NEON.teal, value: NEON.emerald, quality: NEON.amber,
};

type Tone = MockContextCell['dims']['kpi'];
const TONE_HUE: Record<Tone, string> = {
  crit: NEON.red, warn: NEON.amber, ok: NEON.emerald, unmeasured: 'rgba(148,163,184,.45)',
};

type FocusKind = 'crit' | 'warn' | 'setup' | 'ok';
const KIND_HUE: Record<FocusKind, string> = {
  crit: NEON.red, warn: NEON.amber, setup: SETUP_BLUE, ok: NEON.emerald,
};

function focusKind(cell: MockContextCell): FocusKind {
  const t = dominantTone(cell);
  if (t === 'crit') return 'crit';
  if (t === 'warn') return 'warn';
  if (cell.dims.kpi === 'unmeasured' || t === 'unmeasured') return 'setup';
  return 'ok';
}

// -- the interactive KPI-proposals tooltip -------------------------------------------

interface KpiTipState { cell: MockContextCell; proposals: MockProposal[]; rect: DOMRect }

function KpiProposalsTooltip({ tip, onDecide, onEnter, onLeave }: {
  tip: KpiTipState;
  onDecide: (p: MockProposal, verdict: 'accepted' | 'rejected') => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const { left, top } = anchorTip(tip.rect, 360, 90 + tip.proposals.length * 36);
  return createPortal(
    <div
      data-testid="kpi-proposals-tooltip"
      className="fixed z-50 w-[360px] rounded-xl overflow-hidden"
      style={{
        left, top,
        background: 'color-mix(in srgb, var(--background) 88%, #1e293b)',
        border: `1px solid ${NEON.teal}44`,
        boxShadow: '0 16px 40px rgba(0,0,0,.45)',
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="px-3.5 pt-2.5 pb-1.5">
        <span className="text-[10px] uppercase tracking-[0.14em] text-foreground/40">Proposed KPIs — {tip.cell.short}</span>
      </div>
      <table className="w-full border-collapse mb-1.5">
        <thead>
          <tr className="text-left border-b border-foreground/10">
            <th className="text-[9.5px] uppercase tracking-[0.12em] text-foreground/45 font-medium px-3.5 py-1">KPI</th>
            <th className="text-[9.5px] uppercase tracking-[0.12em] text-foreground/45 font-medium px-2 py-1 text-right">Baseline</th>
            <th className="text-[9.5px] uppercase tracking-[0.12em] text-foreground/45 font-medium px-2 py-1 text-right">Target</th>
            <th className="w-px px-2 py-1" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {tip.proposals.map((p) => (
            <tr key={p.id} className="border-b border-foreground/[0.05] last:border-0">
              <td className="px-3.5 py-1.5">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: CATEGORY_HUE[p.category] }} />
                  <span className="typo-caption text-foreground/90 truncate">{p.name}</span>
                  {p.neededConnector && (
                    <span className="inline-flex items-center gap-0.5 text-[9.5px] shrink-0" style={{ color: SETUP_BLUE }}>
                      <Cable className="w-2.5 h-2.5" aria-hidden />
                      {p.neededConnector}
                    </span>
                  )}
                </span>
              </td>
              <td className="px-2 py-1.5 typo-caption tabular-nums text-foreground/70 text-right whitespace-nowrap">
                {p.baseline != null ? `${p.baseline} ${p.unit}` : '—'}
              </td>
              <td className="px-2 py-1.5 typo-caption tabular-nums text-foreground/70 text-right whitespace-nowrap">
                {p.target != null ? `${p.target} ${p.unit}` : '—'}
              </td>
              <td className="px-2 py-1.5 whitespace-nowrap">
                <span className="flex items-center gap-0.5 justify-end">
                  <button
                    type="button"
                    onClick={() => onDecide(p, 'rejected')}
                    aria-label="Reject"
                    title="Reject"
                    className="p-0.5 rounded-interactive hover:bg-red-400/15 transition-colors focus-ring"
                    data-testid={`tip-reject-${p.id}`}
                  >
                    <X className="w-3 h-3" style={{ color: NEON.red }} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDecide(p, 'accepted')}
                    aria-label="Accept"
                    title="Accept"
                    className="p-0.5 rounded-interactive hover:bg-emerald-400/15 transition-colors focus-ring"
                    data-testid={`tip-accept-${p.id}`}
                  >
                    <Check className="w-3 h-3" style={{ color: NEON.emerald }} aria-hidden />
                  </button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>,
    document.body,
  );
}

// -- indicator atoms ------------------------------------------------------------------

function Indicator({ icon: Icon, n, hue, title }: {
  icon: typeof Layers; n: number; hue: string; title: string;
}) {
  const dim = n === 0;
  return (
    <span
      className="inline-flex items-center gap-0.5 tabular-nums text-[9.5px]"
      style={{ color: dim ? 'rgba(148,163,184,.35)' : hue }}
      title={title}
    >
      <Icon className="w-2.5 h-2.5 shrink-0" aria-hidden />
      {n}
    </span>
  );
}

// -- KPI progress divider (Focus grammar) ----------------------------------------------

function KpiLine({ cell, s }: { cell: MockContextCell; s: CellStats }) {
  if (s.kpiPct === null) {
    return <span className="block my-1.5 border-t border-dashed" style={{ borderColor: `${SETUP_BLUE}66` }} />;
  }
  const hue = TONE_HUE[cell.dims.kpi];
  return (
    <span className="block my-1.5 h-[2px] rounded-full relative" style={{ background: 'rgba(148,163,184,.10)' }}>
      <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, s.kpiPct)}%`, background: hue, boxShadow: `0 0 4px ${hue}66` }} />
    </span>
  );
}

// -- the card (Inline winner: everything in the existing two-row structure) -------------

interface CardProps {
  cell: MockContextCell;
  proposals: MockProposal[];
  onKpiHover: (t: KpiTipState) => void;
  onKpiLeave: () => void;
  onNote: (s: string) => void;
}

function Card({ cell, proposals, onKpiHover, onKpiLeave, onNote }: CardProps) {
  const kind = focusKind(cell);
  const s = cellStats(cell);
  const features = mockFeatureCount(cell.id);
  const goals = mockGoalCount(cell.id);
  const hue = KIND_HUE[kind];
  const receded = kind === 'ok';

  const stat = (Icon: typeof AlertTriangle, v: string | null, statHue: string) => (
    <span className="flex items-center gap-1 min-w-0" style={{ color: v === null ? SETUP_BLUE : statHue }}>
      <Icon className="w-3 h-3 shrink-0" aria-hidden />
      <span className="text-[10.5px] font-medium tabular-nums truncate">{v ?? '·'}</span>
    </span>
  );

  const frame =
    kind === 'setup'
      ? { background: `${SETUP_BLUE}0a`, border: `1px dashed ${SETUP_BLUE}55` }
      : receded
        ? { background: 'rgba(52,211,153,.05)', border: '1px solid rgba(52,211,153,.10)' }
        : { background: 'rgba(148,163,184,.045)', border: `1px solid ${hue}${kind === 'crit' ? '66' : '3d'}` };

  const dimKpi = proposals.length === 0;

  return (
    <div className="min-w-0 px-2.5 pt-1.5 pb-2 rounded-lg transition-all hover:-translate-y-[1px]" style={frame} data-testid={`cons-card-${cell.id}`}>
      {/* title row carries the compact coverage counts */}
      <span className="flex items-center gap-1.5 min-w-0">
        {kind === 'setup'
          ? <Wrench className="w-3 h-3 shrink-0" style={{ color: SETUP_BLUE }} aria-hidden />
          : <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: hue, boxShadow: receded ? undefined : `0 0 5px ${hue}88` }} />}
        <span className="typo-caption font-medium text-foreground/90 truncate">{cell.short}</span>
        {cell.mark === 'regressed' && <span className="text-[9px] font-semibold tracking-wide shrink-0" style={{ color: NEON.red }}>▼</span>}
        <span className="ml-auto shrink-0 flex items-center gap-1.5">
          <Indicator icon={Layers} n={features} hue="rgba(148,163,184,.8)" title={`${features} features slice this context`} />
          <Indicator icon={Target} n={goals} hue={NEON.sky} title={`${goals} goals attached`} />
          <span
            className="inline-flex items-center gap-0.5 text-[9.5px] tabular-nums cursor-default"
            style={{ color: dimKpi ? 'rgba(148,163,184,.35)' : NEON.teal }}
            title={dimKpi ? 'No proposed KPIs' : undefined}
            onMouseEnter={(e) => {
              if (!dimKpi) onKpiHover({ cell, proposals, rect: e.currentTarget.getBoundingClientRect() });
            }}
            onMouseLeave={onKpiLeave}
            data-testid={dimKpi ? undefined : `kpi-ind-${cell.id}`}
          >
            <Gauge className="w-2.5 h-2.5 shrink-0" aria-hidden />
            {proposals.length}
          </span>
        </span>
      </span>
      <span className={`block ${receded ? 'opacity-30' : ''}`}>
        <KpiLine cell={cell} s={s} />
        <span className="flex items-center gap-2.5 min-w-0">
          {kind === 'setup' ? (
            <span className="text-[10.5px] font-medium truncate" style={{ color: SETUP_BLUE }}>define KPI · wire sensors →</span>
          ) : (
            <>
              {stat(AlertTriangle, s.errs === null ? null : String(s.errs), TONE_HUE[cell.dims.errors])}
              {stat(CircleDollarSign, s.costUsd === null ? null : `$${s.costUsd}`, TONE_HUE[cell.dims.cost])}
            </>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onNote(`prototype — would run the idea scanner scoped to "${cell.short}"`); }}
            title={`Scan this context (${cell.short})`}
            className="ml-auto inline-flex items-center p-0.5 rounded-interactive transition-colors hover:bg-foreground/[0.08] focus-ring"
            style={{ color: NEON.violet }}
          >
            <Sparkles className="w-2.5 h-2.5" aria-hidden />
          </button>
        </span>
      </span>
    </div>
  );
}

// -- the toolbar (Deck winner: exploded ink buttons, one per scan) -----------------------

interface ScanDef { id: string; label: string; icon: typeof RefreshCw; hue: string }
const SCANS: ScanDef[] = [
  { id: 'kpi', label: 'Scan KPIs', icon: Gauge, hue: NEON.teal },
  { id: 'features', label: 'Scan features', icon: Sparkles, hue: NEON.violet },
  { id: 'rescan', label: 'Re-scan contexts', icon: RefreshCw, hue: NEON.emerald },
  { id: 'full', label: 'Full scan', icon: ScanSearch, hue: NEON.amber },
];

function Toolbar({ onNote, summary }: { onNote: (s: string) => void; summary: string }) {
  return (
    <div className="flex items-center gap-3 flex-wrap" data-testid="cons-toolbar">
      <span className="typo-caption text-foreground/45 min-w-0">{summary}</span>
      <span className="ml-auto inline-flex items-center gap-2 shrink-0">
        {SCANS.map((sc) => (
          <button
            key={sc.id}
            type="button"
            onClick={() => onNote(`prototype — "${sc.label}" runs in the real Factory`)}
            className="inline-flex items-center gap-1.5 rounded-card px-2.5 py-1 typo-caption font-medium transition-colors focus-ring hover:bg-foreground/[0.05]"
            style={{ color: sc.hue, border: `1px solid ${sc.hue}55` }}
          >
            <sc.icon className="w-3.5 h-3.5" aria-hidden />
            {sc.label}
          </button>
        ))}
      </span>
    </div>
  );
}

// -- the consolidated view -----------------------------------------------------------------

export default function CockpitConsolidated({ project }: { project: MockProject }) {
  const [kpiTip, setKpiTip] = useState<KpiTipState | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [decided, setDecided] = useState<Record<string, 'accepted' | 'rejected'>>({});
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const groups = gridFor(project);

  // Hover persistence: the tooltip carries actions now, so it must survive the
  // pointer travelling from the indicator into the tooltip (150ms grace).
  const openTip = (t: KpiTipState) => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    setKpiTip(t);
  };
  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setKpiTip(null), 150);
  };
  const cancelClose = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  };

  if (project.tier === 'bare') {
    return (
      <div className="flex-1 min-h-0 flex flex-col relative" data-testid="cockpit-consolidated">
        <GridMasthead project={project} groups={groups} />
        <GhostGrid project={project} />
      </div>
    );
  }

  const proposalsFor = (cell: MockContextCell) =>
    mockProposalsForCell(cell.id, project.id).filter((p) => !decided[p.id]);

  const decide = (p: MockProposal, verdict: 'accepted' | 'rejected') => {
    setDecided((d) => ({ ...d, [p.id]: verdict }));
    setKpiTip((t) => {
      if (!t) return t;
      const left = t.proposals.filter((x) => x.id !== p.id);
      return left.length > 0 ? { ...t, proposals: left } : null;
    });
    setNote(`"${p.name}" ${verdict} (prototype — persists in the real Factory)`);
  };

  const totalFeatures = groups.reduce((s, g) => s + g.cells.reduce((x, c) => x + mockFeatureCount(c.id), 0), 0);
  const totalGoals = groups.reduce((s, g) => s + g.cells.reduce((x, c) => x + mockGoalCount(c.id), 0), 0);
  const totalProposals = groups.reduce((s, g) => s + g.cells.reduce((x, c) => x + proposalsFor(c).length, 0), 0);
  const summary = `${totalFeatures} features · ${totalGoals} goals · ${totalProposals} proposed KPIs`;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-8 relative" data-testid="cockpit-consolidated">
      <GridMasthead project={project} groups={groups} />
      <div className="mx-5 mt-3">
        <Toolbar onNote={setNote} summary={summary} />
        {note && <p className="typo-caption text-foreground/45 mt-1.5">{note}</p>}
      </div>
      <div className="mx-5 mt-3 grid gap-2.5 relative" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' }}>
        {groups.map((g) => {
          const kinds = g.cells.map(focusKind);
          const crit = kinds.filter((k) => k === 'crit').length;
          const warn = kinds.filter((k) => k === 'warn').length;
          const setup = kinds.filter((k) => k === 'setup').length;
          const worst: FocusKind = crit > 0 ? 'crit' : warn > 0 ? 'warn' : setup === g.cells.length ? 'setup' : 'ok';
          return (
            <div key={g.id} className="rounded-xl p-3" style={{ border: `1px solid ${KIND_HUE[worst]}2e`, background: 'rgba(148,163,184,.025)' }}>
              <div className="flex items-baseline gap-2 mb-2 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full shrink-0 self-center" style={{ background: KIND_HUE[worst], boxShadow: `0 0 5px ${KIND_HUE[worst]}88` }} />
                <h3 className="typo-caption font-semibold tracking-tight text-foreground/85 truncate">{g.name}</h3>
                <span className="ml-auto text-[10px] tabular-nums shrink-0 flex items-center gap-2">
                  {crit > 0 && <span style={{ color: NEON.red }}>{crit} critical</span>}
                  {warn > 0 && <span style={{ color: NEON.amber }}>{warn} warning</span>}
                  {setup > 0 && <span style={{ color: SETUP_BLUE }}>{setup} setup</span>}
                  <span className="text-foreground/30">{g.cells.length}</span>
                </span>
              </div>
              <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
                {g.cells.map((c) => (
                  <Card
                    key={c.id}
                    cell={c}
                    proposals={proposalsFor(c)}
                    onKpiHover={openTip}
                    onKpiLeave={scheduleClose}
                    onNote={setNote}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {kpiTip && (
        <KpiProposalsTooltip
          tip={kpiTip}
          onDecide={decide}
          onEnter={cancelClose}
          onLeave={scheduleClose}
        />
      )}
    </div>
  );
}
