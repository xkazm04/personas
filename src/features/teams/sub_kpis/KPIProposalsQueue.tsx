// KPI proposals review queue (P5 polish: decision cards) — each proposal
// LEADS with the plain-language rationale, shows how it would be measured as
// a sentence (procedure JSON behind a disclosure), carries an evidence chip
// when the baseline was actually measured from the repo, and keeps the
// decision row primary: Accept / Reject, with target adjustment behind a
// progressive "Adjust" affordance.
import { useMemo, useState } from 'react';
import { Cable, Check, FlaskConical, SlidersHorizontal, X } from 'lucide-react';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { categoryMeta, cadenceMeta } from './kpiMeta';
import { describeMeasurement } from './describeMeasurement';

export function KPIProposalsQueue({ onRefresh }: { onRefresh: () => void }) {
  const { t } = useTranslation();
  const kpis = useSystemStore((s) => s.kpis);

  const proposals = useMemo(() => kpis.filter((k) => k.status === 'proposed'), [kpis]);

  if (proposals.length === 0) {
    return (
      <EmptyState
        title={t.kpis.queue_empty_title}
        description={t.kpis.queue_empty_hint}
        action={{ label: t.kpis.queue_refresh, onClick: onRefresh }}
      />
    );
  }

  return (
    <div className="space-y-3" data-testid="kpi-proposals-queue">
      {proposals.map((kpi) => (
        <ProposalCard key={kpi.id} kpi={kpi} />
      ))}
    </div>
  );
}

function ProposalCard({ kpi }: { kpi: DevKpi }) {
  const { t, tx } = useTranslation();
  const updateKpi = useSystemStore((s) => s.updateKpi);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);

  const [adjusting, setAdjusting] = useState(false);
  const [target, setTarget] = useState('');
  const [date, setDate] = useState('');

  const cat = categoryMeta(kpi.category);
  const CatIcon = cat.icon;
  const cad = cadenceMeta(kpi.cadence);

  const accept = async () => {
    const adjusted = target !== '' ? Number(target) : undefined;
    try {
      await updateKpi(kpi.id, {
        status: 'active',
        ...(adjusted != null && Number.isFinite(adjusted) ? { targetValue: adjusted } : {}),
        ...(date ? { targetDate: date } : {}),
      });
    } catch (err) {
      toastCatch('kpi accept', t.kpis.accept_failed)(err);
    }
  };

  const reject = async () => {
    try {
      await updateKpi(kpi.id, { status: 'archived' });
    } catch (err) {
      toastCatch('kpi reject', t.kpis.reject_failed)(err);
    }
  };

  return (
    <div
      className="rounded-card border border-primary/15 bg-secondary/20 p-4 space-y-2"
      data-testid={`kpi-proposal-${kpi.id}`}
    >
      {/* Decision header: name + the WHY, front and center. */}
      <div className="flex items-start gap-2">
        <Tooltip content={cat.label(t)}>
          <CatIcon
            className="w-4 h-4 text-foreground mt-0.5 flex-shrink-0"
            aria-label={cat.label(t)}
          />
        </Tooltip>
        <div className="min-w-0 flex-1">
          <span className="typo-heading text-foreground">{kpi.name}</span>
          {kpi.rationale && <p className="mt-0.5 typo-body text-foreground">{kpi.rationale}</p>}
        </div>
        {kpi.baseline_value != null && (
          <Tooltip content={t.kpis.evidence_tooltip}>
            <span className="inline-flex items-center gap-1 typo-caption text-foreground whitespace-nowrap tabular-nums rounded-interactive border border-success/30 bg-success/10 px-2 py-0.5">
              <FlaskConical className="w-3 h-3" />
              {tx(t.kpis.evidence_chip, { value: kpi.baseline_value, unit: kpi.unit || '' })}
            </span>
          </Tooltip>
        )}
      </div>

      {/* How it would be measured — a sentence, never JSON. */}
      <p className="typo-caption text-foreground opacity-80">
        {describeMeasurement(kpi, t, tx)}
        {kpi.cadence !== 'manual' && <> · {cad.label(t)}</>}
        {kpi.target_value != null && (
          <>
            {' '}
            · {t.kpis.suggested_target_label}: <Numeric value={kpi.target_value} /> {kpi.unit}
          </>
        )}
      </p>
      <details className="typo-caption text-foreground opacity-70">
        <summary className="cursor-pointer select-none">{t.kpis.show_procedure}</summary>
        <code className="block mt-1 font-mono break-all">{kpi.measure_config}</code>
      </details>

      {kpi.needed_connector && (
        <button
          type="button"
          onClick={() => setSidebarSection('credentials')}
          className="inline-flex items-center gap-1 typo-caption text-primary hover:underline"
          data-testid={`kpi-proposal-connect-${kpi.id}`}
        >
          <Cable className="w-3 h-3" />
          {tx(t.kpis.connect_cta, { service: kpi.needed_connector })}
        </button>
      )}

      {/* Decision row — Accept / Reject primary; Adjust folds open. */}
      <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-primary/10">
        <Button
          size="sm"
          variant="ghost"
          icon={<SlidersHorizontal className="w-3.5 h-3.5" />}
          onClick={() => setAdjusting((v) => !v)}
          aria-expanded={adjusting}
          data-testid={`kpi-adjust-${kpi.id}`}
        >
          {t.kpis.adjust_button}
        </Button>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          icon={<X className="w-3.5 h-3.5" />}
          onClick={() => void reject()}
          data-testid={`kpi-reject-${kpi.id}`}
        >
          {t.kpis.reject_button}
        </Button>
        <AsyncButton
          size="sm"
          variant="primary"
          icon={<Check className="w-3.5 h-3.5" />}
          onClick={accept}
          data-testid={`kpi-accept-${kpi.id}`}
        >
          {t.kpis.accept_button}
        </AsyncButton>
      </div>

      {adjusting && (
        <div className="flex items-end gap-2 flex-wrap">
          <label className="flex flex-col gap-0.5 typo-caption text-foreground">
            {tx(t.kpis.target_label, { unit: kpi.unit || '—' })}
            <input
              type="number"
              defaultValue={kpi.target_value ?? undefined}
              onChange={(e) => setTarget(e.target.value)}
              className="w-28 rounded-input border border-primary/15 bg-background px-2 py-1 typo-body text-foreground tabular-nums"
              data-testid={`kpi-target-input-${kpi.id}`}
            />
          </label>
          <label className="flex flex-col gap-0.5 typo-caption text-foreground">
            {t.kpis.target_date_label}
            <input
              type="date"
              defaultValue={kpi.target_date?.slice(0, 10) ?? undefined}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-input border border-primary/15 bg-background px-2 py-1 typo-body text-foreground"
            />
          </label>
        </div>
      )}
    </div>
  );
}
