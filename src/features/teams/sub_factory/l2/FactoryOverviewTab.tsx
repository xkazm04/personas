// Factory L2 — the CONSOLIDATED Overview (R15: Overview + Context map + KPIs
// merged per the bench verdict — Inline cards + Deck toolbar).
//
// The Focus health grid stays the base (real dims: KPI rollups, Sentry errors,
// LLM cost). Folded in:
//   • coverage indicators on every card's title row — Layers = features,
//     Target = goals, Gauge = proposed KPIs whose hover tooltip is the as-is
//     proposals table (KPI/Baseline/Target) WITH the review queue's
//     accept/reject actions (real updateKpi, hover-persistent portal);
//   • the per-context scan action (Sparkles — stub until the unified dispatch
//     concept lands; the idea-scanner path lives in Dev Tools today);
//   • the Deck toolbar aggregating every scan: Scan KPIs · Scan features ·
//     Re-scan contexts (delta) · Full scan — all real, codebase scans register
//     in the activity dock and refetch on CONTEXT_GEN_COMPLETE.
import { useCallback, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Event } from '@tauri-apps/api/event';
import {
  AlertTriangle, Cable, Check, CircleDollarSign, Gauge, Layers, Loader2,
  RefreshCw, ScanSearch, Sparkles, Target, Wrench, X,
} from 'lucide-react';

import { scanCodebase } from '@/api/devTools/devTools';
import { getKpiScanStatus, scanKpis, updateKpi } from '@/api/devTools/kpis';
import type { DevContext } from '@/lib/bindings/DevContext';
import type { DevKpi } from '@/lib/bindings/DevKpi';
import { kpiTrack } from '@/features/teams/sub_kpis/kpiMath';
import { useTauriEvent } from '@/hooks/useTauriEvent';
import { EventName, type ContextGenCompletePayload } from '@/lib/eventRegistry';
import { useOverviewStore } from '@/stores/overviewStore';
import { toastCatch } from '@/lib/silentCatch';

import { INK, anchorTip } from '../passport/passportInk';
import type { FactoryL2Data } from './factoryL2Data';

type Tone = 'crit' | 'warn' | 'ok' | 'unmeasured';
type FocusKind = 'crit' | 'warn' | 'setup' | 'ok';

const TONE_HUE: Record<Tone, string> = {
  crit: INK.red, warn: INK.amber, ok: INK.emerald, unmeasured: 'rgba(148,163,184,.45)',
};
const KIND_HUE: Record<FocusKind, string> = {
  crit: INK.red, warn: INK.amber, setup: INK.blue, ok: INK.emerald,
};
const CATEGORY_HUE: Record<string, string> = {
  technical: INK.violet, traffic: INK.teal, value: INK.emerald, quality: INK.amber,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// -- the real cell (unchanged R11 semantics) -----------------------------------------

interface Cell {
  ctx: DevContext;
  errs: number | null;
  costUsd: number | null;
  kpiPct: number | null;
  dims: { errors: Tone; cost: Tone; kpi: Tone };
  kind: FocusKind;
  kpiCount: number;
}

function kpiAttainment(k: DevKpi): number | null {
  if (k.current_value == null || k.target_value == null) return null;
  if (k.target_value === 0 && k.direction !== 'down') return null;
  const pct =
    k.direction === 'down'
      ? (k.current_value === 0 ? 140 : (k.target_value / k.current_value) * 100)
      : (k.current_value / k.target_value) * 100;
  return Math.max(0, Math.min(140, Math.round(pct)));
}

function buildCell(ctx: DevContext, data: FactoryL2Data, kpisByCtx: Map<string, DevKpi[]>): Cell {
  const errs = data.monitoringWired ? data.runtime.errorsByContext.get(ctx.id) ?? 0 : null;
  const costUsd = data.llmWired ? data.runtime.costByContext.get(ctx.id) ?? 0 : null;
  const ctxKpis = kpisByCtx.get(ctx.id) ?? [];

  let kpiTone: Tone = 'unmeasured';
  let kpiPct: number | null = null;
  const tracks = ctxKpis.map((k) => ({ k, track: kpiTrack(k) })).filter((t) => t.track !== 'unmeasured');
  if (tracks.length > 0) {
    const off = tracks.some((t) => t.track === 'off-track');
    kpiTone = off ? 'crit' : 'ok';
    const pcts = tracks.map((t) => kpiAttainment(t.k)).filter((p): p is number => p !== null);
    if (pcts.length > 0) kpiPct = Math.min(...pcts);
    if (!off && kpiPct !== null && kpiPct < 100) kpiTone = 'warn';
  }

  const errTone: Tone = errs === null ? 'unmeasured' : errs >= 25 ? 'crit' : errs > 0 ? 'warn' : 'ok';
  const costTone: Tone = costUsd === null ? 'unmeasured' : costUsd >= 18 ? 'crit' : costUsd >= 6 ? 'warn' : 'ok';

  const dims = { errors: errTone, cost: costTone, kpi: kpiTone };
  const worst: Tone =
    Object.values(dims).includes('crit') ? 'crit'
    : Object.values(dims).includes('warn') ? 'warn'
    : Object.values(dims).every((t) => t === 'unmeasured') ? 'unmeasured'
    : 'ok';
  const kind: FocusKind =
    worst === 'crit' ? 'crit'
    : worst === 'warn' ? 'warn'
    : kpiTone === 'unmeasured' || worst === 'unmeasured' ? 'setup'
    : 'ok';

  return { ctx, errs, costUsd, kpiPct, dims, kind, kpiCount: ctxKpis.length };
}

// -- KPI progress divider --------------------------------------------------------------

function KpiLine({ c }: { c: Cell }) {
  if (c.kpiPct === null) {
    return <span className="block my-1.5 border-t border-dashed" style={{ borderColor: `${INK.blue}66` }} title={c.kpiCount > 0 ? 'KPIs defined but not measured yet' : 'No KPI defined for this context'} />;
  }
  const hue = TONE_HUE[c.dims.kpi];
  return (
    <span className="block my-1.5 h-[2px] rounded-full relative" style={{ background: 'rgba(148,163,184,.10)' }} title={`Worst KPI at ${c.kpiPct}% of target`}>
      <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, c.kpiPct)}%`, background: hue, boxShadow: `0 0 4px ${hue}66` }} />
    </span>
  );
}

// -- the interactive proposals tooltip ---------------------------------------------------

interface KpiTipState { ctx: DevContext; proposals: DevKpi[]; rect: DOMRect }

function KpiProposalsTooltip({ tip, onDecide, onEnter, onLeave }: {
  tip: KpiTipState;
  onDecide: (k: DevKpi, status: 'active' | 'archived') => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const { left, top } = anchorTip(tip.rect, 360, 90 + tip.proposals.length * 36);
  const num = (v: number | null, unit: string) => (v != null ? `${v} ${unit}` : '—');
  return createPortal(
    <div
      data-testid="factory-kpi-tooltip"
      className="fixed z-50 w-[360px] rounded-xl overflow-hidden"
      style={{
        left, top,
        background: 'color-mix(in srgb, var(--background) 88%, #1e293b)',
        border: `1px solid ${INK.teal}44`,
        boxShadow: '0 16px 40px rgba(0,0,0,.45)',
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="px-3.5 pt-2.5 pb-1.5">
        <span className="text-[10px] uppercase tracking-[0.14em] text-foreground/40">Proposed KPIs — {tip.ctx.name}</span>
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
          {tip.proposals.map((k) => (
            <tr key={k.id} className="border-b border-foreground/[0.05] last:border-0">
              <td className="px-3.5 py-1.5">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: CATEGORY_HUE[k.category] ?? INK.teal }} />
                  <span className="typo-caption text-foreground/90 truncate" title={k.name}>{k.name}</span>
                  {k.needed_connector && (
                    <span className="inline-flex items-center gap-0.5 text-[9.5px] shrink-0" style={{ color: INK.blue }}>
                      <Cable className="w-2.5 h-2.5" aria-hidden />
                      {k.needed_connector}
                    </span>
                  )}
                </span>
              </td>
              <td className="px-2 py-1.5 typo-caption tabular-nums text-foreground/70 text-right whitespace-nowrap">{num(k.baseline_value, k.unit)}</td>
              <td className="px-2 py-1.5 typo-caption tabular-nums text-foreground/70 text-right whitespace-nowrap">{num(k.target_value, k.unit)}</td>
              <td className="px-2 py-1.5 whitespace-nowrap">
                <span className="flex items-center gap-0.5 justify-end">
                  <button
                    type="button"
                    onClick={() => onDecide(k, 'archived')}
                    aria-label="Reject"
                    title="Reject"
                    className="p-0.5 rounded-interactive hover:bg-red-400/15 transition-colors focus-ring"
                    data-testid={`factory-tip-reject-${k.id}`}
                  >
                    <X className="w-3 h-3" style={{ color: INK.red }} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDecide(k, 'active')}
                    aria-label="Accept"
                    title="Accept"
                    className="p-0.5 rounded-interactive hover:bg-emerald-400/15 transition-colors focus-ring"
                    data-testid={`factory-tip-accept-${k.id}`}
                  >
                    <Check className="w-3 h-3" style={{ color: INK.emerald }} aria-hidden />
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

// -- the card (Inline winner) --------------------------------------------------------------

function Indicator({ icon: Icon, n, hue, title }: { icon: typeof Layers; n: number; hue: string; title: string }) {
  const dim = n === 0;
  return (
    <span className="inline-flex items-center gap-0.5 tabular-nums text-[9.5px]" style={{ color: dim ? 'rgba(148,163,184,.35)' : hue }} title={title}>
      <Icon className="w-2.5 h-2.5 shrink-0" aria-hidden />
      {n}
    </span>
  );
}

function Card({ cell, data, onKpiHover, onKpiLeave, onNote }: {
  cell: Cell;
  data: FactoryL2Data;
  onKpiHover: (t: KpiTipState) => void;
  onKpiLeave: () => void;
  onNote: (s: string) => void;
}) {
  const hue = KIND_HUE[cell.kind];
  const receded = cell.kind === 'ok';
  const features = data.featureCountByContext.get(cell.ctx.id) ?? 0;
  const goals = data.goalCountByContext.get(cell.ctx.id) ?? 0;
  const proposals = data.proposalsByContext.get(cell.ctx.id) ?? [];
  const dimKpi = proposals.length === 0;

  const stat = (Icon: typeof AlertTriangle, v: string | null, statHue: string) => (
    <span className="flex items-center gap-1 min-w-0" style={{ color: v === null ? INK.blue : statHue }}>
      <Icon className="w-3 h-3 shrink-0" aria-hidden />
      <span className="text-[10.5px] font-medium tabular-nums truncate">{v ?? '·'}</span>
    </span>
  );

  const frame =
    cell.kind === 'setup'
      ? { background: `${INK.blue}0a`, border: `1px dashed ${INK.blue}55` }
      : receded
        ? { background: 'rgba(52,211,153,.05)', border: '1px solid rgba(52,211,153,.10)' }
        : { background: 'rgba(148,163,184,.045)', border: `1px solid ${hue}${cell.kind === 'crit' ? '66' : '3d'}` };

  const setupAsk =
    cell.dims.kpi === 'unmeasured' && (cell.errs === null || cell.costUsd === null)
      ? 'define KPI · wire sensors →'
      : cell.dims.kpi === 'unmeasured'
        ? (cell.kpiCount > 0 ? 'measure KPI →' : 'define KPI →')
        : 'wire sensors →';

  return (
    <div className="min-w-0 px-2.5 pt-1.5 pb-2 rounded-card transition-all hover:-translate-y-[1px]" style={frame} data-testid={`factory-cons-card-${cell.ctx.id}`}>
      <span className="flex items-center gap-1.5 min-w-0">
        {cell.kind === 'setup'
          ? <Wrench className="w-3 h-3 shrink-0" style={{ color: INK.blue }} aria-hidden />
          : <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: hue, boxShadow: receded ? undefined : `0 0 5px ${hue}88` }} />}
        <span className="typo-caption font-medium text-foreground/90 truncate">{cell.ctx.name}</span>
        <span className="ml-auto shrink-0 flex items-center gap-1.5">
          <Indicator icon={Layers} n={features} hue="rgba(148,163,184,.8)" title={`${features} features slice this context`} />
          <Indicator icon={Target} n={goals} hue="#38BDF8" title={`${goals} goals attached`} />
          <span
            className="inline-flex items-center gap-0.5 text-[9.5px] tabular-nums cursor-default"
            style={{ color: dimKpi ? 'rgba(148,163,184,.35)' : INK.teal }}
            title={dimKpi ? 'No proposed KPIs' : undefined}
            onMouseEnter={(e) => {
              if (!dimKpi) onKpiHover({ ctx: cell.ctx, proposals, rect: e.currentTarget.getBoundingClientRect() });
            }}
            onMouseLeave={onKpiLeave}
            data-testid={dimKpi ? undefined : `factory-kpi-ind-${cell.ctx.id}`}
          >
            <Gauge className="w-2.5 h-2.5 shrink-0" aria-hidden />
            {proposals.length}
          </span>
        </span>
      </span>
      <span className={`block ${receded ? 'opacity-30' : ''}`}>
        <KpiLine c={cell} />
        <span className="flex items-center gap-2.5 min-w-0">
          {cell.kind === 'setup' ? (
            <span className="text-[10.5px] font-medium truncate" style={{ color: INK.blue }}>{setupAsk}</span>
          ) : (
            <>
              {stat(AlertTriangle, cell.errs === null ? null : String(cell.errs), TONE_HUE[cell.dims.errors])}
              {stat(CircleDollarSign, cell.costUsd === null ? null : `$${cell.costUsd.toFixed(0)}`, TONE_HUE[cell.dims.cost])}
            </>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onNote(`Per-context scan for "${cell.ctx.name}" arrives with the unified dispatch concept — use Dev Tools → Idea Scanner meanwhile.`); }}
            title={`Scan this context (${cell.ctx.name})`}
            className="ml-auto inline-flex items-center p-0.5 rounded-interactive transition-colors hover:bg-foreground/[0.08] focus-ring"
            style={{ color: INK.violet }}
          >
            <Sparkles className="w-2.5 h-2.5" aria-hidden />
          </button>
        </span>
      </span>
    </div>
  );
}

// -- the Deck toolbar (real scans) ------------------------------------------------------------

function Toolbar({ data, summary, onNote }: { data: FactoryL2Data; summary: string; onNote: (s: string) => void }) {
  const [kpiScanning, setKpiScanning] = useState(false);
  const [ctxScanId, setCtxScanId] = useState<string | null>(null);

  const scanKpisNow = useCallback(async () => {
    if (!data.project) return;
    setKpiScanning(true);
    try {
      const { scan_id } = await scanKpis(data.project.id);
      for (let i = 0; i < 150; i++) {
        await sleep(2000);
        const st = await getKpiScanStatus(scan_id);
        if (st.status === 'completed' || st.status === 'failed') {
          onNote(st.status === 'completed' ? 'KPI scan complete — fresh proposals on the cards' : st.error ?? 'KPI scan failed');
          break;
        }
      }
      data.reloadKpis();
    } catch (e) {
      toastCatch('factory kpi scan')(e);
    } finally {
      setKpiScanning(false);
    }
  }, [data, onNote]);

  const scanContexts = useCallback((delta: boolean) => {
    const p = data.project;
    if (!p) return;
    void scanCodebase(p.id, p.root_path, delta)
      .then(({ scan_id }) => {
        setCtxScanId(scan_id);
        useOverviewStore.getState().processStarted(
          'factory_scan',
          scan_id,
          `Context scan: ${p.name}`,
          { section: 'plugins', tab: 'context-map' },
        );
      })
      .catch(toastCatch('factory context scan'));
  }, [data.project]);

  const onScanComplete = useCallback(
    (event: Event<ContextGenCompletePayload>) => {
      if (!ctxScanId || event.payload.scan_id !== ctxScanId) return;
      setCtxScanId(null);
      onNote(
        event.payload.status === 'completed'
          ? `Scan complete — ${event.payload.groups_created} groups · ${event.payload.contexts_created} contexts · ${event.payload.files_mapped} files mapped`
          : event.payload.error ?? 'Scan failed',
      );
      data.reloadMap();
    },
    [ctxScanId, data, onNote],
  );
  useTauriEvent<ContextGenCompletePayload>(EventName.CONTEXT_GEN_COMPLETE, onScanComplete);

  const featScanning = data.useCaseState.scanning;
  const btn = (
    label: string,
    icon: React.ReactNode,
    hue: string,
    onClick: () => void,
    disabled: boolean,
    testid: string,
  ) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-card px-2.5 py-1 typo-caption font-medium transition-colors focus-ring hover:bg-foreground/[0.05] disabled:opacity-50"
      style={{ color: hue, border: `1px solid ${hue}55` }}
      data-testid={testid}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="flex items-center gap-3 flex-wrap" data-testid="factory-cons-toolbar">
      <span className="typo-caption text-foreground/45 min-w-0">{summary}</span>
      <span className="ml-auto inline-flex items-center gap-2 shrink-0 flex-wrap">
        {btn(
          kpiScanning ? 'Scanning…' : 'Scan KPIs',
          kpiScanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Gauge className="w-3.5 h-3.5" aria-hidden />,
          INK.teal,
          () => void scanKpisNow(),
          kpiScanning || !data.project,
          'factory-scan-kpis',
        )}
        {btn(
          featScanning ? 'Proposing…' : 'Scan features',
          featScanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Sparkles className="w-3.5 h-3.5" aria-hidden />,
          INK.violet,
          () => void data.useCaseState.scan().catch(toastCatch('factory feature scan')),
          featScanning || data.contexts.length === 0,
          'factory-scan-features',
        )}
        {btn(
          ctxScanId ? 'Scanning…' : 'Re-scan contexts',
          ctxScanId ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <RefreshCw className="w-3.5 h-3.5" aria-hidden />,
          INK.emerald,
          () => scanContexts(true),
          ctxScanId !== null || !data.project,
          'factory-rescan-contexts',
        )}
        {btn(
          ctxScanId ? 'Scanning…' : 'Full scan',
          ctxScanId ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <ScanSearch className="w-3.5 h-3.5" aria-hidden />,
          INK.amber,
          () => scanContexts(false),
          ctxScanId !== null || !data.project,
          'factory-full-scan',
        )}
      </span>
    </div>
  );
}

// -- the consolidated tab -----------------------------------------------------------------------

export function FactoryOverviewTab({ data }: { data: FactoryL2Data }) {
  const [tip, setTip] = useState<KpiTipState | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openTip = (t: KpiTipState) => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    setTip(t);
  };
  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setTip(null), 150);
  };
  const cancelClose = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  };

  const decide = (k: DevKpi, status: 'active' | 'archived') => {
    void updateKpi(k.id, { status })
      .then(() => {
        setTip((t) => {
          if (!t) return t;
          const left = t.proposals.filter((x) => x.id !== k.id);
          return left.length > 0 ? { ...t, proposals: left } : null;
        });
        setNote(`"${k.name}" ${status === 'active' ? 'accepted' : 'rejected'}`);
        data.reloadKpis();
      })
      .catch(toastCatch('factory kpi decide'));
  };

  const kpisByCtx = useMemo(() => {
    const m = new Map<string, DevKpi[]>();
    for (const k of data.kpis) {
      if (!k.context_id || k.status !== 'active') continue;
      const list = m.get(k.context_id);
      if (list) list.push(k);
      else m.set(k.context_id, [k]);
    }
    return m;
  }, [data.kpis]);

  const groups = useMemo(() => {
    const byGroup = new Map<string | null, DevContext[]>();
    for (const c of data.contexts) {
      const key = c.group_id ?? null;
      const list = byGroup.get(key);
      if (list) list.push(c);
      else byGroup.set(key, [c]);
    }
    const named = data.groups
      .map((g) => ({ id: g.id, name: g.name, cells: (byGroup.get(g.id) ?? []).map((c) => buildCell(c, data, kpisByCtx)) }))
      .filter((g) => g.cells.length > 0);
    const ungrouped = (byGroup.get(null) ?? []).map((c) => buildCell(c, data, kpisByCtx));
    if (ungrouped.length > 0) named.push({ id: '__ungrouped', name: 'Ungrouped', cells: ungrouped });
    return named;
  }, [data, kpisByCtx]);

  const summary = useMemo(() => {
    const feats = data.useCaseState.active.length;
    const goals = [...data.goalCountByContext.values()].reduce((s, n) => s + n, 0);
    const proposedCtx = [...data.proposalsByContext.values()].reduce((s, l) => s + l.length, 0);
    const unassigned = data.unassignedProposals.length;
    return `${feats} features · ${goals} goals · ${proposedCtx} proposed KPIs${unassigned > 0 ? ` (+${unassigned} unassigned)` : ''}`;
  }, [data]);

  const total = groups.reduce((s, g) => s + g.cells.length, 0);
  if (!data.loading && total === 0) {
    return (
      <p className="typo-caption text-foreground/45 rounded-card border border-dashed border-foreground/15 px-3 py-5 text-center" data-testid="factory-overview-tab">
        No contexts scanned yet — run a Full scan from the toolbar (or Dev Tools → Context Map) to light this grid.
      </p>
    );
  }

  const summaryCounts = (() => {
    const s = { crit: 0, warn: 0, ok: 0, setup: 0 };
    for (const g of groups) for (const c of g.cells) s[c.kind] += 1;
    return s;
  })();

  return (
    <div className="relative" data-testid="factory-overview-tab">
      <div className="flex items-center gap-3 flex-wrap mb-2">
        <span className="typo-caption tabular-nums flex items-center gap-2.5">
          <span className="text-foreground/40">{total} contexts</span>
          {summaryCounts.crit > 0 && <span style={{ color: INK.red }}>● {summaryCounts.crit} critical</span>}
          {summaryCounts.warn > 0 && <span style={{ color: INK.amber }}>● {summaryCounts.warn} warning</span>}
          {summaryCounts.setup > 0 && <span style={{ color: INK.blue }}>◌ {summaryCounts.setup} setup</span>}
          <span style={{ color: INK.emerald }}>● {summaryCounts.ok} healthy</span>
        </span>
      </div>
      <div className="mb-3">
        <Toolbar data={data} summary={summary} onNote={setNote} />
        {note && <p className="typo-caption text-foreground/45 mt-1.5">{note}</p>}
      </div>
      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' }}>
        {groups.map((g) => {
          const kinds = g.cells.map((c) => c.kind);
          const crit = kinds.filter((k) => k === 'crit').length;
          const warn = kinds.filter((k) => k === 'warn').length;
          const setup = kinds.filter((k) => k === 'setup').length;
          const worst: FocusKind = crit > 0 ? 'crit' : warn > 0 ? 'warn' : setup === g.cells.length ? 'setup' : 'ok';
          return (
            <div key={g.id} className="rounded-modal p-3" style={{ border: `1px solid ${KIND_HUE[worst]}2e`, background: 'rgba(148,163,184,.025)' }}>
              <div className="flex items-baseline gap-2 mb-2 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full shrink-0 self-center" style={{ background: KIND_HUE[worst], boxShadow: `0 0 5px ${KIND_HUE[worst]}88` }} />
                <h3 className="typo-caption font-semibold tracking-tight text-foreground/85 truncate">{g.name}</h3>
                <span className="ml-auto text-[10px] tabular-nums shrink-0 flex items-center gap-2">
                  {crit > 0 && <span style={{ color: INK.red }}>{crit} critical</span>}
                  {warn > 0 && <span style={{ color: INK.amber }}>{warn} warning</span>}
                  {setup > 0 && <span style={{ color: INK.blue }}>{setup} setup</span>}
                  <span className="text-foreground/30">{g.cells.length}</span>
                </span>
              </div>
              <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
                {g.cells.map((c) => (
                  <Card key={c.ctx.id} cell={c} data={data} onKpiHover={openTip} onKpiLeave={scheduleClose} onNote={setNote} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {tip && <KpiProposalsTooltip tip={tip} onDecide={decide} onEnter={cancelClose} onLeave={scheduleClose} />}
    </div>
  );
}
