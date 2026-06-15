// Add a KPI from scratch on the L3 list. The user can type a one-line intent
// and run an LLM background task that proposes the full metadata AND composes +
// tests a measurement (same headless-Claude-on-subscription pattern as the rest
// of the app); the proposal pre-fills the form, which the user reviews and
// saves. Measurement is then refined per-type via the MeasureSetupModal.
import { useEffect, useState } from 'react';
import { Plus, Loader2, Sparkles, X } from 'lucide-react';

import { BaseModal } from '@/lib/ui/BaseModal';
import * as kpiApi from '@/api/devTools/kpis';

import {
  CATEGORY_LABEL,
  KIND_LABEL,
  CADENCE_LABEL,
  type KpiCategory,
  type KpiTier,
  type MeasureKind,
} from './factoryMock';
import { useFactoryData } from './factoryData';
import { useComposeTask, CATEGORY_DEFAULT_KIND, errMsg } from './composeTask';

const CATEGORIES: KpiCategory[] = ['technical', 'quality', 'traffic', 'value'];
const TIERS: { id: KpiTier; label: string }[] = [
  { id: 'north_star', label: 'North star' },
  { id: 'primary', label: 'Primary' },
  { id: 'supporting', label: 'Supporting' },
];
const KINDS: MeasureKind[] = ['codebase', 'connector', 'derived', 'manual'];
const CADENCES = ['manual', 'daily', 'weekly'] as const;

function num(s: string): number | undefined {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}

export function AddKpiModal({
  projectId,
  contextGroupId,
  contextId,
  scopeLabel,
  onClose,
}: {
  projectId: string;
  contextGroupId?: string;
  contextId?: string;
  scopeLabel?: string;
  onClose: () => void;
}) {
  const { reload } = useFactoryData();
  const compose = useComposeTask();

  const [intent, setIntent] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<KpiCategory>('technical');
  const [tier, setTier] = useState<KpiTier>('supporting');
  const [measureKind, setMeasureKind] = useState<MeasureKind>('codebase');
  const [unit, setUnit] = useState('');
  const [direction, setDirection] = useState<'up' | 'down'>('up');
  const [baseline, setBaseline] = useState('');
  const [target, setTarget] = useState('');
  const [cadence, setCadence] = useState<string>('weekly');

  const [measureConfig, setMeasureConfig] = useState<string>('');
  const [metricType, setMetricType] = useState('');
  const [neededConnector, setNeededConnector] = useState('');
  const [rationale, setRationale] = useState('');

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Prefill the form once a proposal lands.
  useEffect(() => {
    const r = compose.status?.result;
    const p = r && 'kpi_proposal' in r ? r.kpi_proposal : undefined;
    if (compose.phase !== 'done' || !p) return;
    setName(p.name ?? '');
    setDescription(p.description ?? '');
    if (CATEGORIES.includes(p.category as KpiCategory)) setCategory(p.category as KpiCategory);
    if (TIERS.some((t) => t.id === p.tier)) setTier(p.tier as KpiTier);
    if (KINDS.includes(p.measure_kind as MeasureKind)) setMeasureKind(p.measure_kind as MeasureKind);
    setUnit(p.unit ?? '');
    setDirection(p.direction === 'down' ? 'down' : 'up');
    if (p.baseline_hint != null) setBaseline(String(p.baseline_hint));
    if (p.suggested_target != null) setTarget(String(p.suggested_target));
    if (p.cadence) setCadence(p.cadence);
    setRationale(p.rationale ?? '');
    setMetricType(p.metric_type ?? '');
    setNeededConnector(p.needed_connector ?? '');
    if (p.measure_config != null) {
      setMeasureConfig(typeof p.measure_config === 'string' ? p.measure_config : JSON.stringify(p.measure_config));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compose.phase, compose.status]);

  const onCategory = (c: KpiCategory) => {
    setCategory(c);
    setMeasureKind(CATEGORY_DEFAULT_KIND[c]);
  };

  const create = async () => {
    if (!name.trim()) { setMsg('Give the KPI a name.'); return; }
    setBusy(true);
    setMsg(null);
    try {
      const kpi = await kpiApi.createKpi({
        projectId,
        name: name.trim(),
        description: description.trim() || undefined,
        contextGroupId,
        contextId,
        category,
        measureKind,
        measureConfig: measureConfig || undefined,
        unit: unit.trim() || undefined,
        direction,
        baselineValue: num(baseline),
        targetValue: num(target),
        cadence,
        status: 'active',
        rationale: rationale.trim() || undefined,
        neededConnector: neededConnector || undefined,
        metricType: metricType || undefined,
      });
      if (tier !== 'supporting') await kpiApi.updateKpi(kpi.id, { tier });
      reload();
      onClose();
    } catch (e) {
      setMsg(errMsg(e));
      setBusy(false);
    }
  };

  const tailLines = compose.lines.slice(-6);
  const sel = 'px-2 py-1.5 typo-body bg-background/50 border border-primary/10 rounded-interactive text-foreground focus-ring';
  const inp = 'w-full px-2 py-1.5 typo-body bg-background/50 border border-primary/10 rounded-interactive text-foreground focus-ring';

  return (
    <BaseModal isOpen onClose={onClose} titleId="factory-add-kpi-title" size="lg" portal>
      <div className="flex flex-col max-h-[85vh]" data-testid="factory-add-kpi">
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
          {/* Intent → propose */}
          <div className="rounded-card border border-primary/15 bg-primary/5 p-3 space-y-2">
            <label className="typo-label text-foreground block">Describe what to measure (optional)</label>
            <div className="flex gap-2">
              <input value={intent} onChange={(e) => setIntent(e.target.value)} placeholder="e.g. keep TypeScript errors at zero" className={inp}
                onKeyDown={(e) => { if (e.key === 'Enter' && intent.trim()) void compose.run(() => kpiApi.proposeKpi(projectId, { contextGroupId, contextId, intent: intent.trim() })); }} />
              <button type="button" disabled={!intent.trim() || compose.phase === 'running'}
                onClick={() => void compose.run(() => kpiApi.proposeKpi(projectId, { contextGroupId, contextId, intent: intent.trim() }))}
                className="inline-flex items-center gap-1.5 rounded-interactive border border-primary/25 bg-primary/10 px-3 py-1.5 typo-body text-foreground hover:bg-primary/20 disabled:opacity-50 whitespace-nowrap">
                {compose.phase === 'running' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {compose.phase === 'running' ? 'Proposing…' : 'Propose with AI'}
              </button>
            </div>
            {(compose.phase === 'running' || tailLines.length > 0) && (
              <pre className="typo-code max-h-32 overflow-y-auto rounded-interactive border border-primary/10 bg-background/50 p-2 whitespace-pre-wrap break-words">{tailLines.join('\n') || 'Starting…'}</pre>
            )}
            {compose.phase === 'error' && <p className="typo-caption text-status-error break-words">{compose.error}</p>}
            {compose.phase === 'done' && <p className="typo-caption text-success">Proposal applied below — review &amp; adjust, then create.</p>}
          </div>

          {/* Metadata form */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="typo-label text-foreground block mb-1">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="TypeScript error count" className={inp} />
            </div>
            <div className="col-span-2">
              <label className="typo-label text-foreground block mb-1">Description</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)} className={inp} />
            </div>
            <div>
              <label className="typo-label text-foreground block mb-1">Category</label>
              <select value={category} onChange={(e) => onCategory(e.target.value as KpiCategory)} className={`${sel} w-full`}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
              </select>
            </div>
            <div>
              <label className="typo-label text-foreground block mb-1">Tier</label>
              <select value={tier} onChange={(e) => setTier(e.target.value as KpiTier)} className={`${sel} w-full`}>
                {TIERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="typo-label text-foreground block mb-1">Measurement</label>
              <select value={measureKind} onChange={(e) => setMeasureKind(e.target.value as MeasureKind)} className={`${sel} w-full`}>
                {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
            </div>
            <div>
              <label className="typo-label text-foreground block mb-1">Direction</label>
              <select value={direction} onChange={(e) => setDirection(e.target.value as 'up' | 'down')} className={`${sel} w-full`}>
                <option value="up">Higher is better</option>
                <option value="down">Lower is better</option>
              </select>
            </div>
            <div>
              <label className="typo-label text-foreground block mb-1">Unit</label>
              <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="%, errors, ms…" className={inp} />
            </div>
            <div>
              <label className="typo-label text-foreground block mb-1">Cadence</label>
              <select value={cadence} onChange={(e) => setCadence(e.target.value)} className={`${sel} w-full`}>
                {CADENCES.map((c) => <option key={c} value={c}>{CADENCE_LABEL[c]}</option>)}
              </select>
            </div>
            <div>
              <label className="typo-label text-foreground block mb-1">Baseline</label>
              <input value={baseline} onChange={(e) => setBaseline(e.target.value)} inputMode="decimal" className={inp} />
            </div>
            <div>
              <label className="typo-label text-foreground block mb-1">Target</label>
              <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" className={inp} />
            </div>
          </div>

          {measureKind === 'connector' && (
            <p className="typo-caption">Connector KPIs need a data source — after creating, open the KPI and use <strong>Configure measurement → Connector</strong>.</p>
          )}
          {msg && <p className="typo-caption text-status-error">{msg}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-primary/10">
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="rounded-interactive border border-primary/15 px-3 py-1.5 typo-body text-foreground hover:bg-secondary/40">Cancel</button>
          <button type="button" disabled={busy || !name.trim()} onClick={() => void create()} className="inline-flex items-center gap-1.5 rounded-interactive border border-primary/30 bg-primary/15 px-3 py-1.5 typo-body text-foreground hover:bg-primary/25 disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create KPI
          </button>
        </div>
      </div>
    </BaseModal>
  );
}
