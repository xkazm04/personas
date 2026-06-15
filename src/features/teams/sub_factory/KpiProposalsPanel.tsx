// D5 — the proposal on-ramp INSIDE the Factory cockpit. KPIs are born from the
// scan; without this the Factory can only show already-active KPIs and can't
// bootstrap its own. Project-scoped: "Scan for KPIs" runs the proposal scan,
// and the review queue (status='proposed') accepts (optionally adjusting the
// target/cadence "volume") / rejects each one. Accept -> active (appears in the
// matrix); reject -> archived (a negative example future scans avoid).
//
// Wired to LIVE commands (the Factory uses real dev_tools data); on accept it
// calls onAccepted() so the parent reloads the matrix.
import { useCallback, useEffect, useState } from 'react';
import { Sparkles, Check, X, SlidersHorizontal, Loader2, Lightbulb } from 'lucide-react';

import { listKpis, updateKpi, scanKpis, getKpiScanStatus } from '@/api/devTools/kpis';
import type { DevKpi } from '@/lib/bindings/DevKpi';

import { CATEGORY_LABEL, CADENCE_LABEL, fmtUnit, type KpiCategory } from './factoryMock';

/** Cadence token → label, tolerant of any stored string. */
const cadenceLabel = (c: string) => CADENCE_LABEL[c as 'daily' | 'weekly' | 'manual'] ?? c;
import { errMsg } from './composeTask';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Human one-liner for a proposal's measurement procedure (measure_config). */
function describeProcedure(cfg: string): string {
  try {
    const o = JSON.parse(cfg) as Record<string, unknown>;
    if (o.cmd) return `runs \`${o.cmd}\``;
    if (o.metric) return `orchestrator metric: ${o.metric}`;
    if (o.connector) return `via ${o.connector}`;
    if (o.recipe) return `recipe: ${o.recipe}`;
    if (o.instruction) return String(o.instruction);
  } catch { /* fall through */ }
  return 'manual measurement';
}

export function KpiProposalsPanel({
  projectId,
  onAccepted,
}: {
  projectId: string;
  onAccepted: () => void;
}) {
  const [proposals, setProposals] = useState<DevKpi[]>([]);
  const [scanning, setScanning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setProposals(await listKpis(projectId, 'proposed'));
    } catch {
      setProposals([]);
    }
  }, [projectId]);

  useEffect(() => {
    let alive = true;
    void listKpis(projectId, 'proposed').then((p) => { if (alive) setProposals(p); }).catch(() => {});
    return () => { alive = false; };
  }, [projectId]);

  const scan = async () => {
    setScanning(true);
    setMsg(null);
    try {
      const { scan_id } = await scanKpis(projectId);
      // Proposals stream in as the scan runs; poll its status, refetching as we
      // go, until it leaves 'running' (or we hit the cap — manual reopen still
      // picks up late arrivals).
      for (let i = 0; i < 40; i++) {
        await sleep(3000);
        await refetch();
        const st = await getKpiScanStatus(scan_id).catch(() => null);
        if (!st || st.status !== 'running') break;
      }
      await refetch();
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setScanning(false);
    }
  };

  const decide = async (kpi: DevKpi, accept: boolean, adjust?: { targetValue?: number; cadence?: string }) => {
    try {
      await updateKpi(kpi.id, accept ? { status: 'active', ...adjust } : { status: 'archived' });
      await refetch();
      if (accept) onAccepted();
    } catch (e) {
      setMsg(errMsg(e));
    }
  };

  return (
    <div className="rounded-card border border-primary/10 bg-secondary/10 px-3 py-2.5 mb-3" data-testid="factory-kpi-proposals">
      <div className="flex items-center gap-2">
        <Lightbulb className="w-4 h-4 text-primary flex-shrink-0" />
        <span className="typo-label text-foreground">KPI proposals</span>
        {proposals.length > 0 && <span className="typo-caption">{proposals.length} to review</span>}
        <span className="flex-1" />
        <button
          type="button"
          onClick={scan}
          disabled={scanning}
          className="typo-caption inline-flex items-center gap-1 rounded-interactive border border-primary/20 bg-primary/10 px-2.5 py-1 text-foreground hover:bg-primary/20 transition-colors disabled:opacity-50"
          data-testid="factory-scan-kpis"
        >
          {scanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          {scanning ? 'Scanning…' : 'Scan for KPIs'}
        </button>
      </div>

      {proposals.length === 0 && !scanning && (
        <p className="typo-caption mt-1.5 opacity-70">
          No proposals waiting. Scan to have Claude propose measurable KPIs from this project&apos;s context map.
        </p>
      )}
      {scanning && proposals.length === 0 && (
        <p className="typo-caption mt-1.5 opacity-70">Reading the context map — proposals appear here as they land.</p>
      )}
      {msg && <p className="typo-caption mt-1.5" style={{ color: 'var(--destructive)' }}>{msg}</p>}

      {proposals.length > 0 && (
        <div className="mt-2 space-y-2">
          {proposals.map((k) => (
            <ProposalCard key={k.id} kpi={k} onDecide={decide} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProposalCard({
  kpi,
  onDecide,
}: {
  kpi: DevKpi;
  onDecide: (kpi: DevKpi, accept: boolean, adjust?: { targetValue?: number; cadence?: string }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [target, setTarget] = useState(kpi.target_value != null ? String(kpi.target_value) : '');
  const [cadence, setCadence] = useState(kpi.cadence);
  const cat = (['technical', 'quality', 'traffic', 'value'].includes(kpi.category) ? kpi.category : 'technical') as KpiCategory;

  const run = async (accept: boolean) => {
    setBusy(true);
    const tv = target.trim() === '' ? undefined : Number(target);
    const adjust = adjusting
      ? { targetValue: Number.isFinite(tv) ? tv : undefined, cadence }
      : undefined;
    await onDecide(kpi, accept, adjust);
    setBusy(false);
  };

  return (
    <div className="rounded-interactive border border-primary/10 bg-background/40 p-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="typo-body text-foreground font-medium">{kpi.name}</span>
            <span className="typo-caption opacity-70">{CATEGORY_LABEL[cat]} · {describeProcedure(kpi.measure_config)}</span>
          </div>
          {kpi.rationale && <p className="typo-caption opacity-80 mt-0.5">{kpi.rationale}</p>}
          <p className="typo-caption opacity-60 mt-0.5">
            target {fmtUnit(kpi.target_value ?? 0, kpi.unit)} · {cadenceLabel(kpi.cadence)}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button type="button" onClick={() => setAdjusting((v) => !v)} title="Adjust target / cadence"
            className="rounded-interactive p-1 text-foreground/60 hover:text-foreground hover:bg-secondary/40 transition-colors">
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </button>
          <button type="button" disabled={busy} onClick={() => run(false)} title="Reject" data-testid={`factory-reject-${kpi.id}`}
            className="rounded-interactive p-1 text-foreground/60 hover:text-[var(--destructive)] hover:bg-[var(--destructive)]/10 transition-colors disabled:opacity-50">
            <X className="w-4 h-4" />
          </button>
          <button type="button" disabled={busy} onClick={() => run(true)} title="Accept" data-testid={`factory-accept-${kpi.id}`}
            className="rounded-interactive p-1 text-[var(--success)] hover:bg-[var(--success)]/10 transition-colors disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          </button>
        </div>
      </div>
      {adjusting && (
        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-primary/10">
          <label className="typo-caption flex items-center gap-1">
            target
            <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal"
              className="w-16 px-1.5 py-0.5 typo-caption bg-secondary/40 border border-primary/10 rounded-interactive text-foreground tabular-nums" />
          </label>
          <label className="typo-caption flex items-center gap-1">
            cadence
            <select value={cadence} onChange={(e) => setCadence(e.target.value)}
              className="px-1.5 py-0.5 typo-caption bg-secondary/40 border border-primary/10 rounded-interactive text-foreground">
              <option value="manual">{CADENCE_LABEL.manual}</option>
              <option value="daily">{CADENCE_LABEL.daily}</option>
              <option value="weekly">{CADENCE_LABEL.weekly}</option>
            </select>
          </label>
          <span className="typo-caption opacity-60">applied on accept</span>
        </div>
      )}
    </div>
  );
}
