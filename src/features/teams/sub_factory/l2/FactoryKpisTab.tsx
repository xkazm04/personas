// Factory L2 — tab (a) KPIs. The proposals queue in the structure of the
// original KPIs module's review table (one dense row per proposal, everything
// textual in the clickable row's detail modal — scannable at 50 proposals),
// restyled in the cockpit ink. Below it, the existing context×KPI matrix keeps
// the L3/L4 drill path alive until the tabs consolidate.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Cable, Check, Loader2, Sparkles, X } from 'lucide-react';

import { getKpiScanStatus, scanKpis, updateKpi } from '@/api/devTools/kpis';
import type { DevKpi } from '@/lib/bindings/DevKpi';
import { BaseModal } from '@/features/shared/components/modals';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { toastCatch } from '@/lib/silentCatch';

import { INK } from '../passport/passportInk';
import type { FactoryL2Data } from './factoryL2Data';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Human one-liner for a proposal's measurement procedure (measure_config). */
function describeProcedure(cfg: string): string {
  try {
    const o = JSON.parse(cfg) as Record<string, unknown>;
    if (o.cmd) return `runs \`${String(o.cmd)}\``;
    if (o.metric) return `orchestrator metric: ${String(o.metric)}`;
    if (o.connector) return `via ${String(o.connector)}`;
    if (o.recipe) return `recipe: ${String(o.recipe)}`;
    if (o.instruction) return String(o.instruction);
  } catch { /* fall through */ }
  return 'manual measurement';
}

const CATEGORY_HUE: Record<string, string> = {
  technical: INK.violet, traffic: INK.teal, value: INK.emerald, quality: INK.amber,
};

function num(v: number | null, unit: string): ReactNode {
  if (v == null) return <span className="text-foreground/35">—</span>;
  return (
    <span className="tabular-nums">
      <Numeric value={v} /> <span className="text-foreground/45">{unit}</span>
    </span>
  );
}

export function FactoryKpisTab({ data, matrix }: { data: FactoryL2Data; matrix: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);

  const proposals = useMemo(() => data.kpis.filter((k) => k.status === 'proposed'), [data.kpis]);
  const active = useMemo(() => data.kpis.filter((k) => k.status === 'active'), [data.kpis]);
  const open = useMemo(() => proposals.find((k) => k.id === openId) ?? null, [proposals, openId]);

  const decide = useCallback(
    (kpi: DevKpi, status: 'active' | 'archived', targetValue?: number) => {
      const updates: Record<string, unknown> = { status };
      if (targetValue != null) updates.targetValue = targetValue;
      void updateKpi(kpi.id, updates)
        .then(() => { setOpenId(null); data.reloadKpis(); })
        .catch(toastCatch('factory kpi decide'));
    },
    [data],
  );

  const scan = useCallback(async () => {
    setScanning(true);
    setScanMsg(null);
    try {
      const { scan_id } = await scanKpis(data.project?.id ?? '');
      for (let i = 0; i < 150; i++) {
        await sleep(2000);
        const st = await getKpiScanStatus(scan_id);
        if (st.status === 'completed' || st.status === 'failed') {
          setScanMsg(st.status === 'completed' ? 'Scan complete — fresh proposals below' : st.error ?? 'Scan failed');
          break;
        }
      }
      data.reloadKpis();
    } catch (e) {
      toastCatch('factory kpi scan')(e);
    } finally {
      setScanning(false);
    }
  }, [data]);

  return (
    <div data-testid="factory-kpis-tab">
      {/* proposals — the on-ramp */}
      <div className="flex items-center gap-3 mb-2">
        <h3 className="text-[10.5px] uppercase tracking-[0.14em] text-foreground/50">Proposals</h3>
        <span className="text-[11px] tabular-nums text-foreground/40">{proposals.length} proposed · {active.length} active</span>
        <button
          type="button"
          onClick={() => void scan()}
          disabled={scanning || !data.project}
          className="ml-auto inline-flex items-center gap-1.5 rounded-card px-2.5 py-1 typo-caption font-medium transition-colors focus-ring hover:bg-foreground/[0.05] disabled:opacity-50"
          style={{ color: INK.teal, border: `1px solid ${INK.teal}55` }}
          data-testid="factory-kpi-scan"
        >
          {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Sparkles className="w-3.5 h-3.5" aria-hidden />}
          Scan for KPIs
        </button>
      </div>
      {scanMsg && <p className="typo-caption text-foreground/55 mb-2">{scanMsg}</p>}

      {proposals.length === 0 ? (
        <p className="typo-caption text-foreground/45 rounded-card border border-dashed border-foreground/15 px-3 py-4 text-center mb-4">
          No proposals waiting — scan to let the app propose KPIs from the context map.
        </p>
      ) : (
        <div className="rounded-modal overflow-hidden mb-4" style={{ border: '1px solid rgba(148,163,184,.14)', background: 'rgba(148,163,184,.025)' }}>
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
              {proposals.map((kpi) => {
                const hue = CATEGORY_HUE[kpi.category] ?? INK.teal;
                return (
                  <tr
                    key={kpi.id}
                    onClick={() => setOpenId(kpi.id)}
                    className="border-b border-foreground/[0.05] hover:bg-foreground/[0.04] cursor-pointer transition-colors"
                    data-testid={`factory-kpi-proposal-${kpi.id}`}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: hue }} title={kpi.category} />
                        <span className="typo-caption font-medium text-foreground truncate">{kpi.name}</span>
                        {kpi.needed_connector && (
                          <span className="inline-flex items-center gap-1 text-[10.5px] shrink-0" style={{ color: INK.blue }} title={`Needs the ${kpi.needed_connector} connector`}>
                            <Cable className="w-3 h-3" aria-hidden />
                            {kpi.needed_connector}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 typo-caption text-foreground/85 text-right">{num(kpi.baseline_value, kpi.unit)}</td>
                    <td className="px-3 py-2 typo-caption text-foreground/85 text-right">{num(kpi.target_value, kpi.unit)}</td>
                    <td className="px-3 py-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <span className="flex items-center gap-1 justify-end">
                        <button
                          type="button"
                          onClick={() => decide(kpi, 'archived')}
                          aria-label="Reject"
                          title="Reject"
                          className="p-1 rounded-interactive text-foreground/45 hover:bg-red-400/15 transition-colors focus-ring"
                          style={{ color: undefined }}
                          data-testid={`factory-kpi-reject-${kpi.id}`}
                        >
                          <X className="w-3.5 h-3.5" style={{ color: INK.red }} aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => decide(kpi, 'active')}
                          aria-label="Accept"
                          title="Accept"
                          className="p-1 rounded-interactive hover:bg-emerald-400/15 transition-colors focus-ring"
                          data-testid={`factory-kpi-accept-${kpi.id}`}
                        >
                          <Check className="w-3.5 h-3.5" style={{ color: INK.emerald }} aria-hidden />
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* the existing context×KPI matrix — keeps the L3 table / L4 console drill
          path alive until the tabs consolidate */}
      {matrix}

      {open && <ProposalDetailModal kpi={open} onDecide={decide} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/** The detail modal — everything textual the dense row hides: description,
 *  rationale, exact measurement procedure, cadence, plus a target adjustment. */
function ProposalDetailModal({ kpi, onDecide, onClose }: {
  kpi: DevKpi;
  onDecide: (kpi: DevKpi, status: 'active' | 'archived', targetValue?: number) => void;
  onClose: () => void;
}) {
  const [target, setTarget] = useState<string>(kpi.target_value != null ? String(kpi.target_value) : '');
  useEffect(() => {
    setTarget(kpi.target_value != null ? String(kpi.target_value) : '');
  }, [kpi.id, kpi.target_value]);
  const hue = CATEGORY_HUE[kpi.category] ?? INK.teal;
  const adjusted = target.trim() === '' ? undefined : Number(target);
  const targetValid = adjusted === undefined || Number.isFinite(adjusted);

  const line = (label: string, value: ReactNode) => (
    <div className="flex gap-3 py-1.5 border-b border-foreground/[0.05] last:border-0">
      <span className="text-[10px] uppercase tracking-[0.12em] text-foreground/40 w-24 shrink-0 pt-0.5">{label}</span>
      <span className="typo-caption text-foreground/85 min-w-0">{value}</span>
    </div>
  );

  return (
    <BaseModal isOpen onClose={onClose} titleId="factory-kpi-proposal-title" size="md" portal>
      <div className="px-1" data-testid="factory-kpi-proposal-modal">
        <h2 id="factory-kpi-proposal-title" className="typo-body font-semibold text-foreground mb-2">{kpi.name}</h2>
        <div className="flex items-center gap-2 mb-3">
          <span className="rounded-full px-2 py-[2px] text-[10px] font-medium tracking-wide" style={{ color: hue, border: `1px solid ${hue}55`, background: `${hue}14` }}>
            {kpi.category}
          </span>
          <span className="text-[10.5px] text-foreground/45">{kpi.cadence} · {kpi.measure_kind}</span>
          {kpi.needed_connector && (
            <span className="inline-flex items-center gap-1 text-[10.5px]" style={{ color: INK.blue }}>
              <Cable className="w-3 h-3" aria-hidden /> needs {kpi.needed_connector}
            </span>
          )}
        </div>

        {kpi.description && line('What', kpi.description)}
        {kpi.rationale && line('Why', kpi.rationale)}
        {line('Procedure', describeProcedure(kpi.measure_config))}
        {line('Baseline', num(kpi.baseline_value, kpi.unit))}
        {line('Direction', kpi.direction === 'down' ? 'lower is better' : 'higher is better')}
        {line(
          'Target',
          <span className="inline-flex items-center gap-1.5">
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              inputMode="decimal"
              className="w-24 bg-transparent border rounded-input px-2 py-0.5 typo-caption tabular-nums text-foreground focus-ring"
              style={{ borderColor: targetValid ? 'rgba(148,163,184,.3)' : INK.red }}
              aria-label="Adjust target"
              data-testid="factory-kpi-target-input"
            />
            <span className="text-foreground/45">{kpi.unit}</span>
          </span>,
        )}

        <div className="flex items-center gap-2 mt-4 mb-1">
          <button
            type="button"
            onClick={() => onDecide(kpi, 'archived')}
            className="inline-flex items-center gap-1.5 rounded-card px-3 py-1.5 typo-caption font-medium transition-colors focus-ring hover:bg-red-400/10"
            style={{ color: INK.red, border: `1px solid ${INK.red}55` }}
            data-testid="factory-kpi-modal-reject"
          >
            <X className="w-3.5 h-3.5" aria-hidden /> Reject
          </button>
          <button
            type="button"
            disabled={!targetValid}
            onClick={() => onDecide(kpi, 'active', adjusted)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-card px-3 py-1.5 typo-caption font-semibold transition-colors focus-ring hover:bg-emerald-400/10 disabled:opacity-50"
            style={{ color: INK.emerald, border: `1px solid ${INK.emerald}55` }}
            data-testid="factory-kpi-modal-accept"
          >
            <Check className="w-3.5 h-3.5" aria-hidden /> Accept{adjusted !== undefined && adjusted !== kpi.target_value ? ' (adjusted)' : ''}
          </button>
        </div>
      </div>
    </BaseModal>
  );
}
