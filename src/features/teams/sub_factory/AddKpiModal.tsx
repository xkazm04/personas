// Add a KPI from scratch on the L3 list. Two paths, chosen by "Measured":
//   · Manually     — the user evaluates the value by hand. All fields required;
//                    the KPI is created ACTIVE immediately, no LLM.
//   · Automatically — a PROPOSED KPI; the backend sets up the measurement in the
//                    background and it lands in Teams › KPIs to review/adjust.
//
// Free-form "describe a KPI and let AI build the whole thing" lives with Athena
// (the chat orb), not here — this is the structured authoring surface. State +
// actions live in `useAddKpi`; this file is the presentational shell.
import { Plus, Loader2, Sparkles, X, MessageSquare } from 'lucide-react';

import { BaseModal } from '@/lib/ui/BaseModal';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { useAskAthena } from '@/features/companions/athena/useAskAthena';

import { type KpiCategory, type KpiTier } from './factoryModel';
import { useAddKpi } from './useAddKpi';
import { useTranslation } from '@/i18n/useTranslation';
import { useKpiSetupOptions, INPUT, Label, MeasurementFields } from './addKpiPrimitives';

export function AddKpiModal({
  projectId, projectName, contextGroupId, contextId, scopeLabel, onClose,
}: {
  projectId: string;
  projectName?: string;
  contextGroupId?: string;
  contextId?: string;
  scopeLabel?: string;
  onClose: () => void;
}) {
  const k = useAddKpi({ projectId, contextGroupId, contextId, onClose });
  const { isManual, busy } = k;
  const { t, tx } = useTranslation();
  const w = t.kpis;
  const o = useKpiSetupOptions();
  const optional = !isManual && <span className="text-foreground/40"> · {w.setup_optional}</span>;

  // Hand off to Athena for a guided, conversational setup (she gathers the
  // shape, proposes the KPI, and the user verifies it in Teams › KPIs).
  // Routed through `useAskAthena` so the prompt is TAGGED as app-composed:
  // this text is the modal's words, not the operator's, and Athena is told so.
  const ask = useAskAthena();
  const askAthena = () => {
    const where = projectName ? ` for the "${projectName}" project` : '';
    ask(
      'Add KPI',
      `The operator opened the Add-KPI form${where} and asked to configure it with you instead. Walk them through it — ask what to measure, whether higher or lower is better, a rough target, how often, and how it is measured — then propose the KPI.`,
    );
    onClose();
  };

  return (
    <BaseModal isOpen onClose={onClose} titleId="factory-add-kpi-title" size="6xl" portal>
      <div className="flex flex-col max-h-[88vh]" data-testid="factory-add-kpi">
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-primary/10">
          <span className="rounded-interactive bg-primary/10 p-2 flex-shrink-0"><Plus className="w-5 h-5 text-primary" /></span>
          <div className="min-w-0 flex-1">
            <h2 id="factory-add-kpi-title" className="typo-heading text-foreground">{w.setup_add_title}</h2>
            <p className="typo-caption truncate">{scopeLabel ? tx(w.setup_scope, { scope: scopeLabel }) : w.setup_scope_project}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t.common.close} className="rounded-interactive p-1.5 text-foreground/70 hover:bg-secondary/40"><X className="w-4 h-4" /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Identity */}
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <Label htmlFor="kpi-name">{t.common.name}</Label>
              <input id="kpi-name" value={k.name} onChange={(e) => k.setName(e.target.value)} placeholder={w.setup_name_ph} className={INPUT} />
            </div>
            <div>
              <Label>{w.setup_category}</Label>
              <ThemedSelect filterable hideSearch options={o.category} value={k.category} onValueChange={(v) => k.onCategory(v as KpiCategory)} aria-label={w.setup_category} />
            </div>
            <div className="col-span-3">
              <Label htmlFor="kpi-desc">{t.common.description}</Label>
              <input id="kpi-desc" value={k.description} onChange={(e) => k.setDescription(e.target.value)} placeholder={w.setup_description_ph} className={INPUT} />
            </div>
            <div>
              <Label>{w.setup_tier}</Label>
              <ThemedSelect filterable hideSearch options={o.tier} value={k.tier} onValueChange={(v) => k.setTier(v as KpiTier)} aria-label={w.setup_tier} />
            </div>
            <div>
              <Label>{w.setup_direction}</Label>
              <ThemedSelect filterable hideSearch options={o.direction} value={k.direction} onValueChange={(v) => k.setDirection(v as 'up' | 'down')} aria-label={w.setup_direction} />
            </div>
            <div>
              <Label htmlFor="kpi-unit">{w.setup_unit}{optional}</Label>
              <input id="kpi-unit" value={k.unit} onChange={(e) => k.setUnit(e.target.value)} placeholder={w.setup_unit_ph} className={INPUT} />
            </div>
          </div>

          <MeasurementFields
            measured={k.measured} setMeasured={k.setMeasured}
            autoKind={k.autoKind} setAutoKind={k.setAutoKind}
            connector={k.connector} setConnector={k.setConnector}
            derivedMetric={k.derivedMetric} setDerivedMetric={k.setDerivedMetric}
            cadence={k.cadence} setCadence={k.setCadence}
            connectorOpts={k.connectorOpts} derivedOpts={k.derivedOpts}
          />

          {/* Targets */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label htmlFor="kpi-baseline">{w.baseline_label}{optional}</Label>
              <input id="kpi-baseline" value={k.baseline} onChange={(e) => k.setBaseline(e.target.value)} inputMode="decimal" className={INPUT} />
            </div>
            <div>
              <Label htmlFor="kpi-target">{w.setup_target}{optional}</Label>
              <input id="kpi-target" value={k.target} onChange={(e) => k.setTarget(e.target.value)} inputMode="decimal" className={INPUT} />
            </div>
            {/* Without a target date there is no pace to lag against, so the KPI
                can never go off-track and goal derivation never sees it
                (`kpi_derivation.rs:75`). Optional, but the modal says why. */}
            <div>
              <Label htmlFor="kpi-target-date">{w.target_date_label}{optional}</Label>
              <input id="kpi-target-date" type="date" value={k.targetDate} onChange={(e) => k.setTargetDate(e.target.value)} className={INPUT} />
            </div>
            <p className="col-span-3 typo-caption text-foreground">
              {w.setup_target_date_hint}
            </p>
          </div>

          {/* Hand off to Athena for a guided conversational setup. */}
          <button
            type="button"
            onClick={askAthena}
            className="w-full flex items-center gap-2 rounded-card border border-primary/15 bg-primary/[0.06] hover:bg-primary/[0.12] transition-colors px-3 py-2 text-left"
            data-testid="factory-ask-athena-kpi"
          >
            <MessageSquare className="w-4 h-4 text-primary flex-shrink-0" />
            <span className="typo-caption text-foreground/80">
              {w.setup_ask_athena_lead} <span className="text-foreground font-medium">{w.setup_ask_athena_link}</span> {w.setup_ask_athena_tail}
            </span>
          </button>

          {k.msg && <p className="typo-caption text-status-error">{k.msg}</p>}
        </div>

        {/* Footer — the button depends on Measured */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-primary/10">
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="rounded-interactive border border-primary/15 px-3 py-1.5 typo-body text-foreground hover:bg-secondary/40">{t.common.cancel}</button>
          {isManual ? (
            <button type="button" disabled={busy || !k.manualReady} onClick={() => void k.createManual()}
              className="inline-flex items-center gap-1.5 rounded-interactive border border-primary/30 bg-primary/15 px-3 py-1.5 typo-body text-foreground hover:bg-primary/25 disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} {w.setup_create}
            </button>
          ) : (
            <button type="button" disabled={busy || !k.name.trim()} onClick={() => void k.setupWithAi()}
              className="inline-flex items-center gap-1.5 rounded-interactive border border-primary/30 bg-primary/15 px-3 py-1.5 typo-body text-foreground hover:bg-primary/25 disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} {busy ? w.setup_setting_up : w.setup_with_ai}
            </button>
          )}
        </div>
      </div>
    </BaseModal>
  );
}
