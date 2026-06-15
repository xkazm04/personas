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
import { useCompanionStore } from '@/features/plugins/companion/companionStore';

import { type KpiCategory, type KpiTier } from './factoryMock';
import { useAddKpi } from './useAddKpi';
import { CATEGORY_OPTS, TIER_OPTS, DIRECTION_OPTS, INPUT, Label, MeasurementFields } from './addKpiPrimitives';

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
  const optional = !isManual && <span className="text-foreground/40"> · optional</span>;

  // Hand off to Athena for a guided, conversational setup (she gathers the
  // shape, proposes the KPI, and the user verifies it in Teams › KPIs).
  const askAthena = () => {
    const where = projectName ? ` for the "${projectName}" project` : '';
    useCompanionStore.getState().setPendingChatPrompt(
      `I'd like to add a new KPI${where}. Walk me through configuring it — ask me what to measure, whether higher or lower is better, a rough target, how often, and how it's measured.`,
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
              <input id="kpi-name" value={k.name} onChange={(e) => k.setName(e.target.value)} placeholder="TypeScript error count" className={INPUT} />
            </div>
            <div>
              <Label>Category</Label>
              <ThemedSelect filterable hideSearch options={CATEGORY_OPTS} value={k.category} onValueChange={(v) => k.onCategory(v as KpiCategory)} aria-label="Category" />
            </div>
            <div className="col-span-3">
              <Label htmlFor="kpi-desc">Description</Label>
              <input id="kpi-desc" value={k.description} onChange={(e) => k.setDescription(e.target.value)} placeholder="What this signal tells you" className={INPUT} />
            </div>
            <div>
              <Label>Tier</Label>
              <ThemedSelect filterable hideSearch options={TIER_OPTS} value={k.tier} onValueChange={(v) => k.setTier(v as KpiTier)} aria-label="Tier" />
            </div>
            <div>
              <Label>Direction</Label>
              <ThemedSelect filterable hideSearch options={DIRECTION_OPTS} value={k.direction} onValueChange={(v) => k.setDirection(v as 'up' | 'down')} aria-label="Direction" />
            </div>
            <div>
              <Label htmlFor="kpi-unit">Unit{optional}</Label>
              <input id="kpi-unit" value={k.unit} onChange={(e) => k.setUnit(e.target.value)} placeholder="%, errors, ms…" className={INPUT} />
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
              <Label htmlFor="kpi-baseline">Baseline{optional}</Label>
              <input id="kpi-baseline" value={k.baseline} onChange={(e) => k.setBaseline(e.target.value)} inputMode="decimal" className={INPUT} />
            </div>
            <div>
              <Label htmlFor="kpi-target">Target{optional}</Label>
              <input id="kpi-target" value={k.target} onChange={(e) => k.setTarget(e.target.value)} inputMode="decimal" className={INPUT} />
            </div>
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
              Prefer to describe it in words? <span className="text-foreground font-medium">Ask Athena</span> — she'll guide you through it and set it up.
            </span>
          </button>

          {k.msg && <p className="typo-caption text-status-error">{k.msg}</p>}
        </div>

        {/* Footer — the button depends on Measured */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-primary/10">
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="rounded-interactive border border-primary/15 px-3 py-1.5 typo-body text-foreground hover:bg-secondary/40">Cancel</button>
          {isManual ? (
            <button type="button" disabled={busy || !k.manualReady} onClick={() => void k.createManual()}
              className="inline-flex items-center gap-1.5 rounded-interactive border border-primary/30 bg-primary/15 px-3 py-1.5 typo-body text-foreground hover:bg-primary/25 disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create KPI
            </button>
          ) : (
            <button type="button" disabled={busy || !k.name.trim()} onClick={() => void k.setupWithAi()}
              className="inline-flex items-center gap-1.5 rounded-interactive border border-primary/30 bg-primary/15 px-3 py-1.5 typo-body text-foreground hover:bg-primary/25 disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} {busy ? 'Setting up…' : 'Set up with AI'}
            </button>
          )}
        </div>
      </div>
    </BaseModal>
  );
}
