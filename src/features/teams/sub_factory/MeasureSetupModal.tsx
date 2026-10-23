// Per-type measurement setup — the sophisticated replacement for the raw JSON
// methodic textarea. A mechanism is defaulted from the KPI's category but is
// switchable:
//   · codebase  → an AI agent composes a shell command, RUNS it in the repo to
//                 verify it returns a number, and saves the tested {cmd, parse}.
//   · connector → reuses the KPIConnectWizard (metric type → credential → AI
//                 composes the retrieval query → live test → freeze).
//   · derived   → one of the orchestrator's own DB metrics.
//   · manual    → no automated measurement; scored by the rating + pros/cons.
import { useState } from 'react';
import { KitButton } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { Wrench, Cable, Database, Hand, Loader2, Check, X, Sparkles } from 'lucide-react';

import { BaseModal } from '@/lib/ui/BaseModal';
import * as kpiApi from '@/api/devTools/kpis';
import type { DevKpi } from '@/lib/bindings/DevKpi';
import { KPIConnectWizard } from '@/features/teams/sub_kpis/KPIConnectWizard';

import { fmtUnit, type MeasureKind, type MockKpi } from './factoryModel';
import { useKpiSetupLabels } from './useKpiSetupLabels';
import { useFactoryData } from './factoryData';
import { useComposeTask, CATEGORY_DEFAULT_KIND, DERIVED_METRICS, errMsg } from './composeTask';

const MECHS: { kind: MeasureKind; icon: typeof Wrench }[] = [
  { kind: 'codebase', icon: Wrench },
  { kind: 'connector', icon: Cable },
  { kind: 'derived', icon: Database },
  { kind: 'manual', icon: Hand },
];

const PARSE_OPTS = ['coverage_pct', 'count_lines', 'regex:(\\d+)', 'json_path:total'];

const FIRST_METRIC = DERIVED_METRICS[0]?.id ?? 'qa_bounce_rate';

function readMetric(cfg: string | undefined): string {
  try {
    return (JSON.parse(cfg ?? '{}') as { metric?: string }).metric ?? FIRST_METRIC;
  } catch {
    return FIRST_METRIC;
  }
}

export function MeasureSetupModal({ kpi, onClose }: { kpi: MockKpi; onClose: () => void }) {
  const { reload } = useFactoryData();
  const [mech, setMech] = useState<MeasureKind>(kpi.measureKind ?? CATEGORY_DEFAULT_KIND[kpi.category]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const { t, tx } = useTranslation();
  const w = t.kpis;
  const words = useKpiSetupLabels();
  const blurbs: Record<MeasureKind, string> = {
    codebase: w.setup_blurb_codebase, connector: w.setup_blurb_connector,
    derived: w.setup_blurb_derived, manual: w.setup_blurb_manual,
  };
  const compose = useComposeTask();

  // connector
  const [devKpi, setDevKpi] = useState<DevKpi | null>(null);
  const [showWizard, setShowWizard] = useState(false);

  // derived
  const [derived, setDerived] = useState<string>(() => readMetric(kpi.measureConfig));

  // advanced codebase manual entry
  const [showAdv, setShowAdv] = useState(false);
  const [cmd, setCmd] = useState('');
  const [parse, setParse] = useState('count_lines');

  const composed =
    compose.status?.result && 'kpi_measure' in compose.status.result
      ? compose.status.result.kpi_measure
      : undefined;

  const applyConfig = async (
    kind: MeasureKind,
    config: string,
    extra?: { value?: number; evidence?: string },
  ) => {
    setBusy(true);
    setMsg(null);
    try {
      await kpiApi.updateKpi(kpi.id, { measureKind: kind, measureConfig: config });
      if (extra?.value != null) {
        await kpiApi.recordKpiMeasurement(kpi.id, extra.value, 'ai-compose', extra.evidence);
      }
      reload();
      onClose();
    } catch (e) {
      setMsg(errMsg(e));
      setBusy(false);
    }
  };

  const openConnector = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const dk = await kpiApi.getKpi(kpi.id);
      setDevKpi(dk);
      setShowWizard(true);
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const tailLines = compose.lines.slice(-7);

  return (
    <BaseModal isOpen onClose={onClose} titleId="factory-measure-setup-title" size="lg" portal>
      <div className="flex flex-col max-h-[82vh]" data-testid="factory-measure-setup">
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-primary/10">
          <span className="rounded-interactive bg-primary/10 p-2 flex-shrink-0">
            <Sparkles className="w-5 h-5 text-primary" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="factory-measure-setup-title" className="typo-heading text-foreground">{w.setup_measure_title}</h2>
            <p className="typo-caption truncate">{kpi.name} · {words.category[kpi.category]}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t.common.close} className="rounded-interactive p-1.5 text-foreground/70 hover:bg-secondary/40">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mechanism picker */}
        <div className="grid grid-cols-4 gap-2 px-5 pt-4">
          {MECHS.map((m) => {
            const Icon = m.icon;
            const on = mech === m.kind;
            return (
              <button
                key={m.kind}
                type="button"
                onClick={() => { setMech(m.kind); setMsg(null); compose.reset(); }}
                className={`rounded-card border px-2.5 py-2 text-left transition-colors ${on ? 'border-primary/40 bg-primary/10' : 'border-primary/10 bg-secondary/10 hover:bg-secondary/30'}`}
                data-testid={`measure-mech-${m.kind}`}
              >
                <Icon className="w-4 h-4 mb-1 text-foreground" />
                <span className="typo-title block">{words.kind[m.kind]}</span>
                <span className="typo-caption block">{blurbs[m.kind]}</span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {/* ---- CODEBASE ---- */}
          {mech === 'codebase' && (
            <div className="space-y-3">
              <p className="typo-body text-foreground/90">{w.setup_codebase_intro}</p>

              <button
                type="button"
                onClick={() => void compose.run(() => kpiApi.composeKpiMeasure(kpi.id))}
                disabled={compose.phase === 'running'}
                className="inline-flex items-center gap-1.5 rounded-interactive border border-primary/25 bg-primary/10 px-3 py-1.5 typo-body text-foreground hover:bg-primary/20 disabled:opacity-50"
              >
                {compose.phase === 'running' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {compose.phase === 'running' ? w.setup_composing : w.setup_compose_run}
              </button>
              {compose.phase === 'running' && (
                <KitButton quiet onClick={() => compose.reset()} testId="measure-compose-cancel">
                  {t.common.cancel}
                </KitButton>
              )}

              {(compose.phase === 'running' || tailLines.length > 0) && (
                <pre className="typo-code max-h-40 overflow-y-auto rounded-interactive border border-primary/10 bg-background/50 p-2 whitespace-pre-wrap break-words">{tailLines.join('\n') || w.setup_starting}</pre>
              )}

              {compose.phase === 'error' && <p className="typo-caption text-status-error break-words">{compose.error}</p>}

              {compose.phase === 'done' && composed === null && (
                <p className="typo-body text-foreground/90 rounded-interactive border border-warning/30 bg-warning/10 p-2.5">{w.setup_not_codebase_lead} <strong>{words.kind.connector}</strong> {w.setup_not_codebase_mid} <strong>{words.kind.manual}</strong>.</p>
              )}

              {compose.phase === 'done' && composed && (
                <div className="rounded-card border border-success/25 bg-success/10 p-3 space-y-2">
                  <div className="flex items-baseline gap-2">
                    <span className="typo-data-lg text-foreground">{fmtUnit(composed.value, kpi.unit)}</span>
                    <span className="typo-caption ml-auto">{w.setup_tested_now}</span>
                  </div>
                  <code className="typo-code block break-all rounded-input bg-background/50 p-2">{composed.cmd}</code>
                  <p className="typo-caption">{tx(w.setup_parse_line, { parse: composed.parse })}{composed.evidence ? ` · ${composed.evidence}` : ''}</p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void applyConfig('codebase', JSON.stringify({ cmd: composed.cmd, parse: composed.parse }), { value: composed.value, evidence: composed.evidence })}
                    className="inline-flex items-center gap-1.5 rounded-interactive border border-success/30 bg-success/15 px-3 py-1.5 typo-body text-foreground hover:bg-success/25 disabled:opacity-50"
                  >
                    <Check className="w-4 h-4" /> {w.setup_use_measurement}
                  </button>
                </div>
              )}

              <button type="button" onClick={() => setShowAdv((v) => !v)} className="typo-caption text-primary hover:underline">
                {showAdv ? w.setup_hide_manual : w.setup_enter_manual}
              </button>
              {showAdv && (
                <div className="space-y-2 rounded-interactive border border-primary/10 bg-secondary/10 p-3">
                  <label className="typo-label text-foreground block">{w.setup_command}</label>
                  <input value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="npx tsc --noEmit 2>&1 | grep -c error" className="w-full px-2 py-1.5 typo-code bg-background/50 border border-primary/10 rounded-interactive text-foreground focus-ring" />
                  <label className="typo-label text-foreground block">{w.setup_parse_label}</label>
                  <select value={parse} onChange={(e) => setParse(e.target.value)} className="w-full px-2 py-1.5 typo-body bg-background/50 border border-primary/10 rounded-interactive text-foreground focus-ring">
                    {PARSE_OPTS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <button type="button" disabled={busy || !cmd.trim()} onClick={() => void applyConfig('codebase', JSON.stringify({ cmd: cmd.trim(), parse }))} className="rounded-interactive border border-primary/20 bg-primary/10 px-3 py-1.5 typo-body text-foreground hover:bg-primary/20 disabled:opacity-50">{w.setup_save_command}</button>
                </div>
              )}
            </div>
          )}

          {/* ---- CONNECTOR ---- */}
          {mech === 'connector' && (
            <div className="space-y-3">
              <p className="typo-body text-foreground/90">{w.setup_connector_intro}</p>
              <button type="button" disabled={busy} onClick={() => void openConnector()} className="inline-flex items-center gap-1.5 rounded-interactive border border-primary/25 bg-primary/10 px-3 py-1.5 typo-body text-foreground hover:bg-primary/20 disabled:opacity-50">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cable className="w-4 h-4" />} {w.setup_connector_open}
              </button>
              <p className="typo-caption">{w.setup_connector_note}</p>
            </div>
          )}

          {/* ---- DERIVED ---- */}
          {mech === 'derived' && (
            <div className="space-y-3">
              <p className="typo-body text-foreground/90">{w.setup_derived_intro}</p>
              <div className="space-y-1.5" role="radiogroup" aria-label={w.setup_derived_aria}>
                {DERIVED_METRICS.map((d) => (
                  <button key={d.id} type="button" role="radio" aria-checked={derived === d.id} onClick={() => setDerived(d.id)} className={`w-full text-left rounded-card border px-3 py-2 transition-colors ${derived === d.id ? 'border-primary/40 bg-primary/10' : 'border-primary/10 bg-secondary/10 hover:bg-secondary/30'}`}>
                    <span className="typo-title block">{words.derived[d.id]?.label ?? d.label}</span>
                    <span className="typo-caption block">{words.derived[d.id]?.hint ?? d.hint}</span>
                  </button>
                ))}
              </div>
              <button type="button" disabled={busy} onClick={() => void applyConfig('derived', JSON.stringify({ metric: derived }))} className="rounded-interactive border border-primary/20 bg-primary/10 px-3 py-1.5 typo-body text-foreground hover:bg-primary/20 disabled:opacity-50">{w.setup_use_metric}</button>
            </div>
          )}

          {/* ---- MANUAL ---- */}
          {mech === 'manual' && (
            <div className="space-y-3">
              <p className="typo-body text-foreground/90">{w.setup_manual_lead} <strong>{w.setup_manual_emph}</strong>. {w.setup_manual_tail}</p>
              {kpi.measureKind !== 'manual' && (
                <button type="button" disabled={busy} onClick={() => void applyConfig('manual', '{}')} className="rounded-interactive border border-primary/20 bg-primary/10 px-3 py-1.5 typo-body text-foreground hover:bg-primary/20 disabled:opacity-50">{w.setup_switch_manual}</button>
              )}
            </div>
          )}

          {msg && <p className="typo-caption text-status-error">{msg}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center px-5 py-3 border-t border-primary/10">
          <span className="typo-caption">{tx(w.setup_current, { kind: words.kind[kpi.measureKind] })}</span>
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="rounded-interactive border border-primary/15 px-3 py-1.5 typo-body text-foreground hover:bg-secondary/40">{t.common.done}</button>
        </div>
      </div>

      {showWizard && devKpi && (
        <KPIConnectWizard
          kpi={devKpi}
          onClose={() => setShowWizard(false)}
          onActivated={() => { reload(); onClose(); }}
        />
      )}
    </BaseModal>
  );
}
