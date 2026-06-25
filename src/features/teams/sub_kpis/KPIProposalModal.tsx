// Proposal detail modal — follows the app's detail-modal golden standard
// (IncidentDetailModal anatomy): a header band with title + meta, content
// SECTIONS under typo-overline headers with typo-body copy, and a footer
// action band. The decision (Accept / Reject) is the footer; everything else
// is reading + one adjustment block.
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
import { categoryMeta, cadenceMeta } from './kpiMeta';
import { describeMeasurement } from './describeMeasurement';
import { KPIConnectWizard } from './KPIConnectWizard';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="typo-overline text-foreground mb-1.5">{title}</h3>
      {children}
    </div>
  );
}

export function KPIProposalModal({ kpi, onClose }: { kpi: DevKpi; onClose: () => void }) {
  const { t, tx } = useTranslation();
  const updateKpi = useSystemStore((s) => s.updateKpi);

  const [target, setTarget] = useState('');
  const [date, setDate] = useState('');
  const [connectOpen, setConnectOpen] = useState(false);

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
      <div className="flex flex-col max-h-[80vh]" data-testid="kpi-proposal-modal">
        {/* Header band */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-primary/10">
          <span className="rounded-interactive bg-primary/10 p-2 flex-shrink-0">
            <CatIcon className="w-5 h-5 text-primary" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="kpi-proposal-modal-title" className="typo-heading text-foreground">
              {kpi.name}
            </h2>
            <p className="typo-caption text-foreground mt-0.5">
              {cat.label(t)} · {cad.label(t)}
              {kpi.baseline_value != null && (
                <span className="inline-flex items-center gap-1 ml-2 tabular-nums rounded-interactive border border-status-success/30 bg-status-success/10 px-1.5 py-0.5">
                  <FlaskConical className="w-3 h-3" />
                  {tx(t.kpis.evidence_chip, { value: kpi.baseline_value, unit: kpi.unit || '' })}
                </span>
              )}
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

        {/* Content sections */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {kpi.rationale && (
            <Section title={t.kpis.section_why}>
              <p className="typo-body text-foreground">{kpi.rationale}</p>
            </Section>
          )}
          {kpi.description && (
            <Section title={t.kpis.section_what}>
              <p className="typo-body text-foreground">{kpi.description}</p>
            </Section>
          )}

          <Section title={t.kpis.section_how}>
            <p className="typo-body text-foreground">{describeMeasurement(kpi, t, tx)}</p>
            {kpi.baseline_value != null && (
              <p className="typo-caption text-foreground mt-1 inline-flex items-center gap-1">
                {t.kpis.evidence_tooltip}
              </p>
            )}
            <details className="typo-caption text-foreground opacity-80 mt-1.5">
              <summary className="cursor-pointer select-none">{t.kpis.show_procedure}</summary>
              <code className="typo-code block mt-1 break-all rounded-input bg-secondary/30 p-2">
                {kpi.measure_config}
              </code>
            </details>
            {kpi.needed_connector && (
              <button
                type="button"
                onClick={() => setConnectOpen(true)}
                className="mt-2 inline-flex items-center gap-1 typo-caption text-primary rounded-card px-1.5 py-1 hover:bg-secondary/40 transition-colors focus-ring"
              >
                <Cable className="w-3 h-3" />
                {tx(t.kpis.connect_cta, { service: kpi.needed_connector })}
              </button>
            )}
          </Section>

          <Section title={t.kpis.section_target}>
            <div className="flex items-end gap-3 flex-wrap">
              <label className="flex flex-col gap-0.5 typo-caption text-foreground">
                {tx(t.kpis.target_label, { unit: kpi.unit || '—' })}
                <input
                  type="number"
                  defaultValue={kpi.target_value ?? undefined}
                  onChange={(e) => setTarget(e.target.value)}
                  className="w-32 rounded-input border border-border bg-secondary/30 px-3 py-2 typo-body text-foreground tabular-nums focus-ring"
                  data-testid="kpi-modal-target-input"
                />
              </label>
              <label className="flex flex-col gap-0.5 typo-caption text-foreground">
                {t.kpis.target_date_label}
                <input
                  type="date"
                  defaultValue={kpi.target_date?.slice(0, 10) ?? undefined}
                  onChange={(e) => setDate(e.target.value)}
                  className="rounded-input border border-border bg-secondary/30 px-3 py-2 typo-body text-foreground focus-ring"
                />
              </label>
              {kpi.target_value != null && (
                <p className="typo-caption text-foreground pb-2">
                  {t.kpis.suggested_target_label}: <Numeric value={kpi.target_value} /> {kpi.unit}
                </p>
              )}
            </div>
          </Section>
        </div>

        {/* Footer action band */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-primary/10">
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
      {connectOpen && (
        <KPIConnectWizard kpi={kpi} onClose={() => setConnectOpen(false)} />
      )}
    </BaseModal>
  );
}
