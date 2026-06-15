// Add a KPI from scratch on the L3 list. Two paths, chosen by "Measured":
//   · Manually     — the user evaluates the value by hand. All fields are
//                    required; the KPI is created ACTIVE immediately, no LLM.
//   · Automatically — the measurement is set up by an LLM (Claude Code CLI).
//                    The KPI is created PROPOSED and the compose sets up the
//                    measurement (+ baseline) — it then appears in Teams › KPIs
//                    as a proposal to review/adjust.
//
// Free-form "describe a KPI and let AI build the whole thing" is intentionally
// NOT here — that conversational path lives with Athena (the chat orb). This
// modal is the structured authoring surface.
import { useEffect, useMemo, useState } from 'react';
import { Plus, Loader2, Sparkles, X, MessageSquare } from 'lucide-react';

import { BaseModal } from '@/lib/ui/BaseModal';
import { ThemedSelect, type ThemedSelectOption } from '@/features/shared/components/forms/ThemedSelect';
import * as kpiApi from '@/api/devTools/kpis';
import { listCredentials } from '@/api/vault/credentials';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';

import { type KpiCategory, type KpiTier, type MeasureKind } from './factoryMock';
import { useFactoryData } from './factoryData';
import { CATEGORY_DEFAULT_KIND, errMsg } from './composeTask';
import {
  CATEGORY_OPTS, TIER_OPTS, DIRECTION_OPTS, INPUT, Label, MeasurementFields, num, type Measured,
} from './addKpiPrimitives';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function AddKpiModal({
  projectId, contextGroupId, contextId, scopeLabel, onClose,
}: {
  projectId: string;
  contextGroupId?: string;
  contextId?: string;
  scopeLabel?: string;
  onClose: () => void;
}) {
  const { reload } = useFactoryData();

  const [progress, setProgress] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<KpiCategory>('technical');
  const [tier, setTier] = useState<KpiTier>('supporting');
  const [direction, setDirection] = useState<'up' | 'down'>('up');
  const [measured, setMeasured] = useState<Measured>('auto');
  const [autoKind, setAutoKind] = useState<MeasureKind>('codebase');
  const [connector, setConnector] = useState('');
  const [unit, setUnit] = useState('');
  const [baseline, setBaseline] = useState('');
  const [target, setTarget] = useState('');
  const [cadence, setCadence] = useState<string>('weekly');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [creds, setCreds] = useState<PersonaCredential[]>([]);
  useEffect(() => {
    let alive = true;
    void listCredentials().then((c) => { if (alive) setCreds(c); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const connectorOpts: ThemedSelectOption[] = useMemo(
    () => creds.map((c) => ({ value: c.serviceType, label: c.name, description: c.serviceType })),
    [creds],
  );

  const onCategory = (c: KpiCategory) => {
    setCategory(c);
    const def = CATEGORY_DEFAULT_KIND[c];
    if (def !== 'manual') setAutoKind(def);
  };

  const isManual = measured === 'manual';
  const manualReady = name.trim() !== '' && unit.trim() !== '' && num(baseline) != null && num(target) != null;

  /** Run the codebase measurement compose for the new KPI, poll to completion,
   *  and apply the tested {cmd, parse} + the first verified reading. */
  const composeAndApply = async (kpiId: string) => {
    const { task_id } = await kpiApi.composeKpiMeasure(kpiId);
    for (let i = 0; i < 90; i++) {
      await sleep(1500);
      const s = await kpiApi.getKpiComposeStatus(task_id).catch(() => null);
      if (!s) continue;
      setProgress(s.lines ?? []);
      if (s.status === 'completed') {
        const m = s.result && 'kpi_measure' in s.result ? s.result.kpi_measure : undefined;
        if (m) {
          await kpiApi.updateKpi(kpiId, { measureConfig: JSON.stringify({ cmd: m.cmd, parse: m.parse }) });
          if (typeof m.value === 'number') {
            await kpiApi.recordKpiMeasurement(kpiId, m.value, 'ai-compose');
            if (num(baseline) == null) await kpiApi.updateKpi(kpiId, { baselineValue: m.value });
          }
        }
        return;
      }
      if (s.status === 'failed' || s.status === 'cancelled' || s.status === 'not_found') return;
    }
  };

  const createManual = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const kpi = await kpiApi.createKpi({
        projectId, name: name.trim(), description: description.trim() || undefined,
        contextGroupId, contextId, category, measureKind: 'manual',
        unit: unit.trim() || undefined, direction,
        baselineValue: num(baseline), targetValue: num(target),
        cadence, status: 'active',
      });
      if (tier !== 'supporting') await kpiApi.updateKpi(kpi.id, { tier });
      reload();
      onClose();
    } catch (e) {
      setMsg(errMsg(e));
      setBusy(false);
    }
  };

  const setupWithAi = async () => {
    if (!name.trim()) { setMsg('Give the KPI a name.'); return; }
    setBusy(true);
    setMsg(null);
    try {
      const kpi = await kpiApi.createKpi({
        projectId, name: name.trim(), description: description.trim() || undefined,
        contextGroupId, contextId, category, measureKind: autoKind,
        unit: unit.trim() || undefined, direction,
        baselineValue: num(baseline), targetValue: num(target),
        cadence, status: 'proposed',
        neededConnector: autoKind === 'connector' ? (connector || undefined) : undefined,
      });
      if (tier !== 'supporting') await kpiApi.updateKpi(kpi.id, { tier });
      // Codebase composes a repo command here; connector (Connect flow) and
      // derived (metric pick) are finished in the proposal.
      if (autoKind === 'codebase') {
        setProgress(['Setting up the measurement…']);
        await composeAndApply(kpi.id);
      }
      reload();
      onClose();
    } catch (e) {
      setMsg(errMsg(e));
      setBusy(false);
    }
  };

  return (
    <BaseModal isOpen onClose={onClose} titleId="factory-add-kpi-title" size="6xl" portal>
      <div className="flex flex-col max-h-[88vh]" data-testid="factory-add-kpi">
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-primary/10">
          <span className="rounded-interactive bg-primary/10 p-2 flex-shrink-0"><Plus className="w-5 h-5 text-primary" /></span>
          <div className="min-w-0 flex-1">
            <h2 id="factory-add-kpi-title" className="typo-heading text-foreground">Add a KPI</h2>
            <p className="typo-caption truncate">{scopeLabel ? `Scope: ${scopeLabel}` : 'Project-level'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-interactive p-1.5 text-foreground/70 hover:bg-secondary/40"><X className="w-4 h-4" /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Identity */}
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <Label htmlFor="kpi-name">Name</Label>
              <input id="kpi-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="TypeScript error count" className={INPUT} />
            </div>
            <div>
              <Label>Category</Label>
              <ThemedSelect filterable hideSearch options={CATEGORY_OPTS} value={category} onValueChange={(v) => onCategory(v as KpiCategory)} aria-label="Category" />
            </div>
            <div className="col-span-3">
              <Label htmlFor="kpi-desc">Description</Label>
              <input id="kpi-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this signal tells you" className={INPUT} />
            </div>
            <div>
              <Label>Tier</Label>
              <ThemedSelect filterable hideSearch options={TIER_OPTS} value={tier} onValueChange={(v) => setTier(v as KpiTier)} aria-label="Tier" />
            </div>
            <div>
              <Label>Direction</Label>
              <ThemedSelect filterable hideSearch options={DIRECTION_OPTS} value={direction} onValueChange={(v) => setDirection(v as 'up' | 'down')} aria-label="Direction" />
            </div>
            <div>
              <Label htmlFor="kpi-unit">Unit{!isManual && <span className="text-foreground/40"> · optional</span>}</Label>
              <input id="kpi-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="%, errors, ms…" className={INPUT} />
            </div>
          </div>

          <MeasurementFields
            measured={measured} setMeasured={setMeasured}
            autoKind={autoKind} setAutoKind={setAutoKind}
            connector={connector} setConnector={setConnector}
            cadence={cadence} setCadence={setCadence}
            connectorOpts={connectorOpts}
          />

          {/* Targets */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label htmlFor="kpi-baseline">Baseline{!isManual && <span className="text-foreground/40"> · optional</span>}</Label>
              <input id="kpi-baseline" value={baseline} onChange={(e) => setBaseline(e.target.value)} inputMode="decimal" className={INPUT} />
            </div>
            <div>
              <Label htmlFor="kpi-target">Target{!isManual && <span className="text-foreground/40"> · optional</span>}</Label>
              <input id="kpi-target" value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" className={INPUT} />
            </div>
          </div>

          {busy && !isManual && autoKind === 'codebase' && progress.length > 0 && (
            <pre className="typo-code max-h-32 overflow-y-auto rounded-interactive border border-primary/10 bg-background/50 p-2 whitespace-pre-wrap break-words">{progress.slice(-6).join('\n')}</pre>
          )}

          {/* Athena pointer (replaces the old describe→populate AI box) */}
          <div className="flex items-center gap-2 rounded-card border border-primary/10 bg-primary/[0.04] px-3 py-2">
            <MessageSquare className="w-4 h-4 text-primary flex-shrink-0" />
            <span className="typo-caption text-foreground/80">
              Prefer to describe it in words? Ask <span className="text-foreground font-medium">Athena</span> in the chat — she can propose and set up KPIs for this project for you.
            </span>
          </div>

          {msg && <p className="typo-caption text-status-error">{msg}</p>}
        </div>

        {/* Footer — the button depends on Measured */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-primary/10">
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="rounded-interactive border border-primary/15 px-3 py-1.5 typo-body text-foreground hover:bg-secondary/40">Cancel</button>
          {isManual ? (
            <button type="button" disabled={busy || !manualReady} onClick={() => void createManual()}
              className="inline-flex items-center gap-1.5 rounded-interactive border border-primary/30 bg-primary/15 px-3 py-1.5 typo-body text-foreground hover:bg-primary/25 disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create KPI
            </button>
          ) : (
            <button type="button" disabled={busy || !name.trim()} onClick={() => void setupWithAi()}
              className="inline-flex items-center gap-1.5 rounded-interactive border border-primary/30 bg-primary/15 px-3 py-1.5 typo-body text-foreground hover:bg-primary/25 disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} {busy ? 'Setting up…' : 'Set up with AI'}
            </button>
          )}
        </div>
      </div>
    </BaseModal>
  );
}
