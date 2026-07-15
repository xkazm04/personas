// R14 — CONSOLIDATION TRIAL: Overview + Context map + KPIs collapse into ONE
// surface. The Focus health grid stays the base; the context-map coverage and
// the KPI proposals fold INTO the context card as icon+number indicators —
// Features (Layers) · Goals (Target) · proposed KPIs (Gauge, tooltip carries
// the as-is proposals list with the tab's column structure) · per-context scan
// (Sparkles). The toolbar aggregates every scan the two donor tabs offered:
// KPI scan, Feature scan, Context re-scan, Context full scan.
//
// /prototype — TWO variants behind the bench switcher:
//   • Deck   — the card grows an ADDITIONAL indicators row (room to breathe);
//     toolbar = exploded ink buttons, one per scan.
//   • Inline — every indicator squeezed into the EXISTING two-row structure
//     (title row carries compact counts, scan sits in the stats row);
//     toolbar = a single "Scans ▾" menu (portal) with described entries.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle, Cable, ChevronDown, CircleDollarSign, Gauge, Layers,
  RefreshCw, ScanSearch, Sparkles, Target, Wrench,
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

export type ConsolidatedVariant = 'deck' | 'inline';

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

// -- the per-context coverage bundle -----------------------------------------------

interface Coverage {
  features: number;
  goals: number;
  proposals: MockProposal[];
}

function coverageFor(cell: MockContextCell, projectId: string): Coverage {
  return {
    features: mockFeatureCount(cell.id),
    goals: mockGoalCount(cell.id),
    proposals: mockProposalsForCell(cell.id, projectId),
  };
}

// -- the KPI-proposals tooltip: the tab's list, as-is, anchored to the icon --------

interface KpiTipState { cell: MockContextCell; proposals: MockProposal[]; rect: DOMRect }

function KpiProposalsTooltip({ tip }: { tip: KpiTipState }) {
  const { left, top } = anchorTip(tip.rect, 340, 90 + tip.proposals.length * 34);
  return createPortal(
    <div
      data-testid="kpi-proposals-tooltip"
      className="fixed z-50 w-[340px] pointer-events-none rounded-xl overflow-hidden"
      style={{
        left, top,
        background: 'color-mix(in srgb, var(--background) 88%, #1e293b)',
        border: `1px solid ${NEON.teal}44`,
        boxShadow: '0 16px 40px rgba(0,0,0,.45)',
      }}
    >
      <div className="px-3.5 pt-2.5 pb-1.5">
        <span className="text-[10px] uppercase tracking-[0.14em] text-foreground/40">Proposed KPIs — {tip.cell.short}</span>
      </div>
      <table className="w-full border-collapse mb-1.5">
        <thead>
          <tr className="text-left border-b border-foreground/10">
            <th className="text-[9.5px] uppercase tracking-[0.12em] text-foreground/45 font-medium px-3.5 py-1">KPI</th>
            <th className="text-[9.5px] uppercase tracking-[0.12em] text-foreground/45 font-medium px-2 py-1 text-right">Baseline</th>
            <th className="text-[9.5px] uppercase tracking-[0.12em] text-foreground/45 font-medium px-3.5 py-1 text-right">Target</th>
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
              <td className="px-3.5 py-1.5 typo-caption tabular-nums text-foreground/70 text-right whitespace-nowrap">
                {p.target != null ? `${p.target} ${p.unit}` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>,
    document.body,
  );
}

// -- indicator atoms (SAME experience in both variants) -----------------------------

function Indicator({ icon: Icon, n, hue, title, compact }: {
  icon: typeof Layers; n: number; hue: string; title: string; compact?: boolean;
}) {
  const dim = n === 0;
  return (
    <span
      className={`inline-flex items-center ${compact ? 'gap-0.5' : 'gap-1'} tabular-nums ${compact ? 'text-[9.5px]' : 'text-[10.5px]'}`}
      style={{ color: dim ? 'rgba(148,163,184,.35)' : hue }}
      title={title}
    >
      <Icon className={compact ? 'w-2.5 h-2.5 shrink-0' : 'w-3 h-3 shrink-0'} aria-hidden />
      {n}
    </span>
  );
}

function KpiIndicator({ cell, proposals, compact, onHover, onLeave }: {
  cell: MockContextCell; proposals: MockProposal[]; compact?: boolean;
  onHover: (t: KpiTipState) => void; onLeave: () => void;
}) {
  const dim = proposals.length === 0;
  return (
    <span
      className={`inline-flex items-center ${compact ? 'gap-0.5 text-[9.5px]' : 'gap-1 text-[10.5px]'} tabular-nums cursor-default`}
      style={{ color: dim ? 'rgba(148,163,184,.35)' : NEON.teal }}
      title={dim ? 'No proposed KPIs' : undefined}
      onMouseEnter={(e) => {
        if (!dim) onHover({ cell, proposals, rect: e.currentTarget.getBoundingClientRect() });
      }}
      onMouseLeave={onLeave}
      data-testid={dim ? undefined : `kpi-ind-${cell.id}`}
    >
      <Gauge className={compact ? 'w-2.5 h-2.5 shrink-0' : 'w-3 h-3 shrink-0'} aria-hidden />
      {proposals.length}
    </span>
  );
}

function ScanAction({ cell, compact, onNote }: { cell: MockContextCell; compact?: boolean; onNote: (s: string) => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onNote(`prototype — would run the idea scanner scoped to "${cell.short}"`); }}
      title={`Scan this context (${cell.short})`}
      className="inline-flex items-center p-0.5 rounded-interactive transition-colors hover:bg-foreground/[0.08] focus-ring"
      style={{ color: NEON.violet }}
    >
      <Sparkles className={compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} aria-hidden />
    </button>
  );
}

// -- KPI progress divider (Focus grammar) --------------------------------------------

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

// -- the cards ------------------------------------------------------------------------

interface CardProps {
  cell: MockContextCell;
  projectId: string;
  onKpiHover: (t: KpiTipState) => void;
  onKpiLeave: () => void;
  onNote: (s: string) => void;
}

/** Variant DECK — the card grows a dedicated indicators row. */
function DeckCard({ cell, projectId, onKpiHover, onKpiLeave, onNote }: CardProps) {
  const kind = focusKind(cell);
  const s = cellStats(cell);
  const cov = coverageFor(cell, projectId);
  const hue = KIND_HUE[kind];
  const receded = kind === 'ok';

  const stat = (Icon: typeof AlertTriangle, v: string | null, statHue: string) => (
    <span className="flex items-center gap-1 min-w-0" style={{ color: v === null ? SETUP_BLUE : statHue }}>
      <Icon className="w-3 h-3 shrink-0" aria-hidden />
      <span className="text-[10.5px] font-medium tabular-nums truncate">{v ?? '·'}</span>
    </span>
  );

  const indicators = (
    <span className="flex items-center gap-2.5 min-w-0 pt-1.5 mt-1.5 border-t border-foreground/[0.06]">
      <Indicator icon={Layers} n={cov.features} hue="rgba(148,163,184,.8)" title={`${cov.features} features slice this context`} />
      <Indicator icon={Target} n={cov.goals} hue={NEON.sky} title={`${cov.goals} goals attached`} />
      <KpiIndicator cell={cell} proposals={cov.proposals} onHover={onKpiHover} onLeave={onKpiLeave} />
      <span className="ml-auto"><ScanAction cell={cell} onNote={onNote} /></span>
    </span>
  );

  const frame =
    kind === 'setup'
      ? { background: `${SETUP_BLUE}0a`, border: `1px dashed ${SETUP_BLUE}55` }
      : receded
        ? { background: 'rgba(52,211,153,.05)', border: '1px solid rgba(52,211,153,.10)' }
        : { background: 'rgba(148,163,184,.045)', border: `1px solid ${hue}${kind === 'crit' ? '66' : '3d'}` };

  return (
    <div className="min-w-0 px-2.5 pt-1.5 pb-2 rounded-lg transition-all hover:-translate-y-[1px]" style={frame} data-testid={`cons-card-${cell.id}`}>
      <span className="flex items-center gap-1.5 min-w-0">
        {kind === 'setup'
          ? <Wrench className="w-3 h-3 shrink-0" style={{ color: SETUP_BLUE }} aria-hidden />
          : <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: hue, boxShadow: receded ? undefined : `0 0 5px ${hue}88` }} />}
        <span className="typo-caption font-medium text-foreground/90 truncate">{cell.short}</span>
        {cell.mark === 'regressed' && <span className="ml-auto text-[9px] font-semibold tracking-wide shrink-0" style={{ color: NEON.red }}>▼ REG</span>}
      </span>
      <span className={`block ${receded ? 'opacity-30' : ''}`}>
        <KpiLine cell={cell} s={s} />
        <span className="flex items-center gap-2.5 min-w-0">
          {kind === 'setup' ? (
            <span className="text-[10.5px] font-medium" style={{ color: SETUP_BLUE }}>define KPI · wire sensors →</span>
          ) : (
            <>
              {stat(AlertTriangle, s.errs === null ? null : String(s.errs), TONE_HUE[cell.dims.errors])}
              {stat(CircleDollarSign, s.costUsd === null ? null : `$${s.costUsd}`, TONE_HUE[cell.dims.cost])}
            </>
          )}
        </span>
      </span>
      {indicators}
    </div>
  );
}

/** Variant INLINE — every indicator inside the existing two-row structure. */
function InlineCard({ cell, projectId, onKpiHover, onKpiLeave, onNote }: CardProps) {
  const kind = focusKind(cell);
  const s = cellStats(cell);
  const cov = coverageFor(cell, projectId);
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

  return (
    <div className="min-w-0 px-2.5 pt-1.5 pb-2 rounded-lg transition-all hover:-translate-y-[1px]" style={frame} data-testid={`cons-card-${cell.id}`}>
      {/* title row also carries the compact coverage counts */}
      <span className="flex items-center gap-1.5 min-w-0">
        {kind === 'setup'
          ? <Wrench className="w-3 h-3 shrink-0" style={{ color: SETUP_BLUE }} aria-hidden />
          : <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: hue, boxShadow: receded ? undefined : `0 0 5px ${hue}88` }} />}
        <span className="typo-caption font-medium text-foreground/90 truncate">{cell.short}</span>
        {cell.mark === 'regressed' && <span className="text-[9px] font-semibold tracking-wide shrink-0" style={{ color: NEON.red }}>▼</span>}
        <span className="ml-auto shrink-0 flex items-center gap-1.5">
          <Indicator icon={Layers} n={cov.features} hue="rgba(148,163,184,.8)" title={`${cov.features} features slice this context`} compact />
          <Indicator icon={Target} n={cov.goals} hue={NEON.sky} title={`${cov.goals} goals attached`} compact />
          <KpiIndicator cell={cell} proposals={cov.proposals} compact onHover={onKpiHover} onLeave={onKpiLeave} />
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
          <span className="ml-auto"><ScanAction cell={cell} compact onNote={onNote} /></span>
        </span>
      </span>
    </div>
  );
}

// -- the toolbars ----------------------------------------------------------------------

interface ScanDef { id: string; label: string; desc: string; icon: typeof RefreshCw; hue: string }
const SCANS: ScanDef[] = [
  { id: 'kpi', label: 'Scan KPIs', desc: 'propose KPIs from the context map', icon: Gauge, hue: NEON.teal },
  { id: 'features', label: 'Scan features', desc: 'propose features (use cases)', icon: Sparkles, hue: NEON.violet },
  { id: 'rescan', label: 'Re-scan contexts', desc: 'incremental — refresh changed areas', icon: RefreshCw, hue: NEON.emerald },
  { id: 'full', label: 'Full scan', desc: 'rebuild the whole context map', icon: ScanSearch, hue: NEON.amber },
];

/** Deck toolbar — exploded: one ink button per scan. */
function ToolbarDeck({ onNote, summary }: { onNote: (s: string) => void; summary: string }) {
  return (
    <div className="flex items-center gap-3 flex-wrap" data-testid="cons-toolbar-deck">
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

/** Inline toolbar — consolidated: one "Scans" menu with described entries. */
function ToolbarInline({ onNote, summary }: { onNote: (s: string) => void; summary: string }) {
  const [menu, setMenu] = useState<DOMRect | null>(null);
  return (
    <div className="flex items-center gap-3 flex-wrap" data-testid="cons-toolbar-inline">
      <span className="typo-caption text-foreground/45 min-w-0">{summary}</span>
      <button
        type="button"
        data-testid="cons-scans-menu-btn"
        onClick={(e) => setMenu(menu ? null : e.currentTarget.getBoundingClientRect())}
        className="ml-auto inline-flex items-center gap-1.5 rounded-card px-2.5 py-1 typo-caption font-semibold transition-colors focus-ring hover:bg-foreground/[0.05] shrink-0"
        style={{ color: NEON.teal, border: `1px solid ${NEON.teal}55` }}
      >
        <ScanSearch className="w-3.5 h-3.5" aria-hidden />
        Scans
        <ChevronDown className="w-3 h-3" aria-hidden />
      </button>
      {menu && createPortal(
        <div
          data-testid="cons-scans-menu"
          className="fixed z-50 w-[280px] rounded-xl overflow-hidden py-1"
          style={{
            ...anchorTip(menu, 280, 40 + SCANS.length * 44),
            background: 'color-mix(in srgb, var(--background) 88%, #1e293b)',
            border: '1px solid rgba(148,163,184,.22)',
            boxShadow: '0 16px 40px rgba(0,0,0,.45)',
          }}
          onMouseLeave={() => setMenu(null)}
        >
          {SCANS.map((sc) => (
            <button
              key={sc.id}
              type="button"
              onClick={() => { setMenu(null); onNote(`prototype — "${sc.label}" runs in the real Factory`); }}
              className="w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-foreground/[0.05]"
            >
              <sc.icon className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: sc.hue }} aria-hidden />
              <span className="min-w-0">
                <span className="typo-caption font-medium text-foreground block">{sc.label}</span>
                <span className="text-[10px] text-foreground/45 block">{sc.desc}</span>
              </span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

// -- the consolidated view ---------------------------------------------------------------

export default function CockpitConsolidated({ project, variant }: { project: MockProject; variant: ConsolidatedVariant }) {
  const [kpiTip, setKpiTip] = useState<KpiTipState | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const groups = gridFor(project);

  if (project.tier === 'bare') {
    return (
      <div className="flex-1 min-h-0 flex flex-col relative" data-testid="cockpit-consolidated">
        <GridMasthead project={project} groups={groups} />
        <GhostGrid project={project} />
      </div>
    );
  }

  const totalFeatures = groups.reduce((s, g) => s + g.cells.reduce((x, c) => x + mockFeatureCount(c.id), 0), 0);
  const totalGoals = groups.reduce((s, g) => s + g.cells.reduce((x, c) => x + mockGoalCount(c.id), 0), 0);
  const totalProposals = groups.reduce((s, g) => s + g.cells.reduce((x, c) => x + mockProposalsForCell(c.id, project.id).length, 0), 0);
  const summary = `${totalFeatures} features · ${totalGoals} goals · ${totalProposals} proposed KPIs`;

  const Card = variant === 'deck' ? DeckCard : InlineCard;
  const Toolbar = variant === 'deck' ? ToolbarDeck : ToolbarInline;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-8 relative" data-testid="cockpit-consolidated" onMouseLeave={() => setKpiTip(null)}>
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
                    projectId={project.id}
                    onKpiHover={setKpiTip}
                    onKpiLeave={() => setKpiTip(null)}
                    onNote={setNote}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {kpiTip && <KpiProposalsTooltip tip={kpiTip} />}
    </div>
  );
}
