// Proposal detail modal (P5 round 2) — the second layer behind the proposals
// table row: the full rationale + description, the measurement in plain
// language with the exact procedure behind a disclosure, target/date
// adjustment, and the Accept / Reject decision. BaseModal per the
// enforce-base-modal convention.
import { useState } from 'react';
import { Cable, Check, FlaskConical, X } from 'lucide-react';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { categoryMeta, cadenceMeta } from './kpiMeta';
import { describeMeasurement } from './describeMeasurement';

export function KPIProposalModal({ kpi, onClose }: { kpi: DevKpi; onClose: () => void }) {
  const { t, tx } = useTranslation();
  const updateKpi = useSystemStore((s) => s.updateKpi);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);

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
      onClose();
    } catch (err) {
      toastCatch('kpi accept', t.kpis.accept_failed)(err);
    }
  };

  const reject = async () => {
    try {
      await updateKpi(kpi.id, { status: 'archived' });
      onClose();
    } catch (err) {
      toastCatch('kpi reject', t.kpis.reject_failed)(err);
    }
  };

  return (
    <BaseModal isOpen onClose={onClose} titleId="kpi-proposal-modal-title" size="md" portal>
      <div className="p-5 space-y-3" data-testid="kpi-proposal-modal">
        <div className="flex items-start gap-2">
          <CatIcon className="w-5 h-5 text-foreground mt-0.5 flex-shrink-0" aria-label={cat.label(t)} />
          <div className="min-w-0 flex-1">
            <h2 id="kpi-proposal-modal-title" className="typo-heading text-foreground">
              {kpi.name}
            </h2>
            <p className="typo-caption text-foreground">
              {cat.label(t)} · {cad.label(t)}
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            icon={<X className="w-4 h-4" />}
            onClick={onClose}
            aria-label={t.common.close}
          />
        </div>

        {kpi.rationale && <p className="typo-body text-foreground">{kpi.rationale}</p>}
        {kpi.description && (
          <p className="typo-body text-foreground opacity-90">{kpi.description}</p>
        )}

        <div className="rounded-card border border-primary/15 bg-secondary/20 p-3 space-y-1">
          <p className="typo-caption text-foreground">{describeMeasurement(kpi, t, tx)}</p>
          {kpi.baseline_value != null && (
            <p className="inline-flex items-center gap-1 typo-caption text-foreground tabular-nums">
              <FlaskConical className="w-3 h-3" />
              {tx(t.kpis.evidence_chip, { value: kpi.baseline_value, unit: kpi.unit || '' })}
              <Tooltip content={t.kpis.evidence_tooltip}>
                <span className="underline decoration-dotted cursor-help">ⓘ</span>
              </Tooltip>
            </p>
          )}
          <details className="typo-caption text-foreground opacity-70">
            <summary className="cursor-pointer select-none">{t.kpis.show_procedure}</summary>
            <code className="block mt-1 font-mono break-all">{kpi.measure_config}</code>
          </details>
        </div>

        {kpi.needed_connector && (
          <button
            type="button"
            onClick={() => setSidebarSection('credentials')}
            className="inline-flex items-center gap-1 typo-caption text-primary hover:underline"
          >
            <Cable className="w-3 h-3" />
            {tx(t.kpis.connect_cta, { service: kpi.needed_connector })}
          </button>
        )}

        <div className="flex items-end gap-3 flex-wrap">
          <label className="flex flex-col gap-0.5 typo-caption text-foreground">
            {tx(t.kpis.target_label, { unit: kpi.unit || '—' })}
            <input
              type="number"
              defaultValue={kpi.target_value ?? undefined}
              onChange={(e) => setTarget(e.target.value)}
              className="w-32 rounded-input border border-primary/15 bg-background px-2 py-1 typo-body text-foreground tabular-nums"
              data-testid="kpi-modal-target-input"
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
          {kpi.target_value != null && (
            <p className="typo-caption text-foreground opacity-70 pb-1.5">
              {t.kpis.suggested_target_label}: <Numeric value={kpi.target_value} /> {kpi.unit}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 pt-2 border-t border-primary/10">
          <div className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            icon={<X className="w-3.5 h-3.5" />}
            onClick={() => void reject()}
            data-testid="kpi-modal-reject"
          >
            {t.kpis.reject_button}
          </Button>
          <AsyncButton
            size="sm"
            variant="primary"
            icon={<Check className="w-3.5 h-3.5" />}
            onClick={accept}
            data-testid="kpi-modal-accept"
          >
            {t.kpis.accept_button}
          </AsyncButton>
        </div>
      </div>
    </BaseModal>
  );
}
