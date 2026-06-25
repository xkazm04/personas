// Connect-source wizard (P6) — binds a KPI to a METRIC TYPE, never a tool.
// Golden-standard modal anatomy (header band / typo-overline sections /
// footer band). Flow: pick metric type (if the KPI lacks one) → pick a
// compatible vault connection (or quick-add one) → compose the retrieval
// procedure (built-in recipe, else AI composes ONCE) → live test against the
// real API → user confirms → the procedure freezes and is replayed
// deterministically on every future measurement.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Cable, Check, Plus, Sparkles, X, Zap } from 'lucide-react';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { extractMessage, toastCatch } from '@/lib/silentCatch';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { QuickAddCredentialModal } from '@/features/templates/sub_generated/adoption/QuickAddCredentialModal';
import {
  activateKpiBinding,
  composeKpiBinding,
  kpiMatchingCredentials,
  listKpiMetricTypes,
  type KpiComposeResult,
  type KpiMatchingCredential,
  type KpiMetricType,
} from '@/api/devTools/kpis';

type Step = 'type' | 'pick' | 'compose' | 'verify';

const normalize = (s: string) => s.toLowerCase().replace(/[-_]/g, '');

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="typo-overline text-foreground mb-1.5">{title}</h3>
      {children}
    </div>
  );
}

export function ComposedByBadge({ composedBy }: { composedBy: string }) {
  const { t } = useTranslation();
  const recipe = composedBy === 'recipe';
  return (
    <span
      className={`inline-flex items-center gap-1 typo-caption tabular-nums rounded-interactive border px-1.5 py-0.5 ${
        recipe
          ? 'border-status-success/30 bg-status-success/10 text-foreground'
          : 'border-primary/30 bg-primary/10 text-foreground'
      }`}
    >
      {recipe ? <Zap className="w-3 h-3" aria-hidden /> : <Sparkles className="w-3 h-3" aria-hidden />}
      {recipe ? t.kpis.wizard_recipe_badge : t.kpis.wizard_llm_badge}
    </span>
  );
}

export function KPIConnectWizard({
  kpi,
  onClose,
  onActivated,
}: {
  kpi: DevKpi;
  onClose: () => void;
  onActivated?: () => void;
}) {
  const { t, tx } = useTranslation();
  const updateKpi = useSystemStore((s) => s.updateKpi);
  const fetchAllKpis = useSystemStore((s) => s.fetchAllKpis);

  const [metricTypeId, setMetricTypeId] = useState(kpi.metric_type);
  const [step, setStep] = useState<Step>(kpi.metric_type ? 'pick' : 'type');
  const [types, setTypes] = useState<KpiMetricType[]>([]);
  const [matches, setMatches] = useState<KpiMatchingCredential[] | null>(null);
  const [picked, setPicked] = useState<KpiMatchingCredential | null>(null);
  const [result, setResult] = useState<KpiComposeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quickAdd, setQuickAdd] = useState(false);

  const metricType = useMemo(
    () => types.find((m) => m.id === metricTypeId) ?? null,
    [types, metricTypeId],
  );

  useEffect(() => {
    listKpiMetricTypes()
      .then(setTypes)
      .catch(toastCatch('kpi metric types', t.kpis.wizard_compose_failed));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMatches = useCallback(
    (typeId: string) =>
      kpiMatchingCredentials(typeId)
        .then((m) => {
          setMatches(m);
          return m;
        })
        .catch((err: unknown) => {
          toastCatch('kpi matching credentials', t.kpis.wizard_compose_failed)(err);
          return [] as KpiMatchingCredential[];
        }),
    [t],
  );

  useEffect(() => {
    if (metricTypeId) void loadMatches(metricTypeId);
  }, [metricTypeId, loadMatches]);

  const pickType = async (mt: KpiMetricType) => {
    try {
      await updateKpi(kpi.id, { metricType: mt.id });
      setMetricTypeId(mt.id);
      setStep('pick');
    } catch (err) {
      toastCatch('kpi set metric type', t.kpis.wizard_compose_failed)(err);
    }
  };

  const compose = async (cred: KpiMatchingCredential) => {
    setPicked(cred);
    setError(null);
    setResult(null);
    setStep('compose');
    try {
      const r = await composeKpiBinding(kpi.id, cred.credential_id);
      setResult(r);
      setStep('verify');
    } catch (err) {
      // Compose/verify errors are written for users in the backend
      // (unconfident composer, invariant breach, API status) — show them
      // verbatim; the registry would genericize them away.
      setError(extractMessage(err) || resolveErrorTranslated(t, null).message);
      setStep('verify');
    }
  };

  const activate = async () => {
    if (!picked || !result) return;
    try {
      await activateKpiBinding(
        kpi.id,
        picked.credential_id,
        result.procedure,
        result.composed_by,
        result.value,
        result.evidence,
      );
      await fetchAllKpis();
      onActivated?.();
      onClose();
    } catch (err) {
      toastCatch('kpi activate binding', t.kpis.wizard_compose_failed)(err);
    }
  };

  const onCredentialAdded = (serviceType: string) => {
    setQuickAdd(false);
    if (!metricTypeId) return;
    void loadMatches(metricTypeId).then((m) => {
      const added = m.find((c) => normalize(c.service_type) === normalize(serviceType));
      if (added) void compose(added);
    });
  };

  return (
    <BaseModal isOpen onClose={onClose} titleId="kpi-connect-wizard-title" size="md" portal>
      <div className="flex flex-col max-h-[80vh]" data-testid="kpi-connect-wizard">
        {/* Header band */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-primary/10">
          <span className="rounded-interactive bg-primary/10 p-2 flex-shrink-0">
            <Cable className="w-5 h-5 text-primary" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="kpi-connect-wizard-title" className="typo-heading text-foreground">
              {t.kpis.connect_wizard_title}
            </h2>
            <p className="typo-caption text-foreground mt-0.5 truncate">
              {kpi.name}
              {metricType ? ` · ${metricType.label}` : ''}
            </p>
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            icon={<X className="w-4 h-4" />}
            onClick={onClose}
            aria-label={t.common.close}
          />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {metricType && step !== 'type' && (
            <p className="typo-body text-foreground opacity-90">
              {tx(t.kpis.wizard_metric_line, {
                label: metricType.label,
                contract: metricType.contract,
              })}
            </p>
          )}

          {step === 'type' && (
            <Section title={t.kpis.wizard_type_section}>
              <p className="typo-body text-foreground mb-2">{t.kpis.wizard_type_hint}</p>
              <div className="space-y-1.5" role="radiogroup" aria-label={t.kpis.wizard_type_section}>
                {types.map((mt) => (
                  <button
                    key={mt.id}
                    type="button"
                    role="radio"
                    aria-checked={metricTypeId === mt.id}
                    onClick={() => void pickType(mt)}
                    className="w-full text-left rounded-card border border-primary/15 bg-secondary/20 hover:bg-secondary/40 px-3 py-2 transition-colors focus-ring"
                    data-testid={`kpi-metric-type-${mt.id}`}
                  >
                    <span className="typo-body text-foreground font-medium">{mt.label}</span>
                    <span className="typo-caption text-foreground block opacity-80">{mt.contract}</span>
                  </button>
                ))}
                {types.length === 0 && <LoadingSpinner size="sm" />}
              </div>
            </Section>
          )}

          {step === 'pick' && (
            <Section title={t.kpis.wizard_pick_section}>
              {matches == null ? (
                <LoadingSpinner size="sm" />
              ) : matches.length === 0 ? (
                <p className="typo-body text-foreground">{t.kpis.wizard_no_matches}</p>
              ) : (
                <div className="space-y-1.5">
                  {matches.map((c) => (
                    <button
                      key={c.credential_id}
                      type="button"
                      onClick={() => void compose(c)}
                      className="w-full flex items-center gap-2.5 text-left rounded-card border border-primary/15 bg-secondary/20 hover:bg-secondary/40 px-3 py-2 transition-colors focus-ring"
                      data-testid={`kpi-wizard-cred-${c.credential_id}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="typo-body text-foreground font-medium block truncate">
                          {c.name}
                        </span>
                        <span className="typo-caption text-foreground opacity-80">
                          {c.connector_label}
                        </span>
                      </span>
                      <ComposedByBadge composedBy={c.has_recipe ? 'recipe' : 'llm'} />
                    </button>
                  ))}
                </div>
              )}
              <Button
                size="sm"
                variant="secondary"
                icon={<Plus className="w-3.5 h-3.5" />}
                onClick={() => setQuickAdd(true)}
                className="mt-2.5"
                data-testid="kpi-wizard-add-connector"
              >
                {t.kpis.wizard_add_connector}
              </Button>
            </Section>
          )}

          {step === 'compose' && picked && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <LoadingSpinner size="md" />
              <p className="typo-body text-foreground">
                {tx(t.kpis.wizard_composing, { service: picked.connector_label })}
              </p>
              <p className="typo-caption text-foreground opacity-80">{t.kpis.wizard_testing_note}</p>
            </div>
          )}

          {step === 'verify' && error && (
            <Section title={t.kpis.wizard_compose_failed}>
              <p className="typo-body text-status-error break-words">{error}</p>
            </Section>
          )}

          {step === 'verify' && result && picked && (
            <>
              <Section title={t.kpis.wizard_verify_section}>
                <div className="rounded-card border border-status-success/25 bg-status-success/10 px-4 py-3 flex items-baseline gap-2">
                  <span className="typo-title text-foreground tabular-nums">
                    <Numeric value={result.value} />
                  </span>
                  <span className="typo-body text-foreground">{kpi.unit || metricType?.unit || ''}</span>
                  <span className="typo-caption text-foreground opacity-80 ml-auto">
                    {t.kpis.wizard_measured_now}
                  </span>
                </div>
              </Section>

              <Section title={t.kpis.wizard_plan_section}>
                <p className="typo-body text-foreground">
                  {result.procedure.plan || result.procedure.extract}
                </p>
                <p className="typo-caption text-foreground opacity-80 mt-1 flex items-center gap-1.5 flex-wrap">
                  <ComposedByBadge composedBy={result.composed_by} />
                  {result.composed_by === 'recipe'
                    ? t.kpis.wizard_freeze_note_recipe
                    : t.kpis.wizard_freeze_note_llm}
                </p>
              </Section>

              <Section title={t.kpis.wizard_request_section}>
                <code className="typo-code block break-all rounded-input bg-secondary/30 p-2">
                  {result.procedure.http.method} {result.procedure.http.url}
                </code>
                {result.evidence && (
                  <details className="typo-caption text-foreground opacity-80 mt-1.5">
                    <summary className="cursor-pointer select-none">
                      {t.kpis.wizard_evidence_toggle}
                    </summary>
                    <code className="typo-code block mt-1 break-all rounded-input bg-secondary/30 p-2 max-h-40 overflow-y-auto">
                      {result.evidence}
                    </code>
                  </details>
                )}
              </Section>
            </>
          )}
        </div>

        {/* Footer action band */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-primary/10">
          {step === 'verify' && (
            <Button
              size="sm"
              variant="ghost"
              icon={<ArrowLeft className="w-3.5 h-3.5" />}
              onClick={() => {
                setError(null);
                setResult(null);
                setStep('pick');
              }}
              data-testid="kpi-wizard-back"
            >
              {t.kpis.wizard_pick_other}
            </Button>
          )}
          <div className="flex-1" />
          {step === 'verify' && error && picked && (
            <AsyncButton size="sm" variant="secondary" onClick={() => compose(picked)}>
              {t.kpis.wizard_retry}
            </AsyncButton>
          )}
          {step === 'verify' && result && (
            <AsyncButton
              size="sm"
              variant="primary"
              icon={<Check className="w-3.5 h-3.5" />}
              onClick={activate}
              data-testid="kpi-wizard-activate"
            >
              {t.kpis.wizard_activate}
            </AsyncButton>
          )}
        </div>
      </div>

      {quickAdd && metricType && (
        <QuickAddCredentialModal
          category={metricType.categories[0] ?? 'analytics'}
          categoryLabel={metricType.label}
          onCredentialAdded={onCredentialAdded}
          onClose={() => setQuickAdd(false)}
        />
      )}
    </BaseModal>
  );
}
