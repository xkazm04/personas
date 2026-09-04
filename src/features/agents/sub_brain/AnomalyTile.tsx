import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { AnomalyStrip } from '@/lib/bindings/AnomalyStrip';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

/**
 * The react-to-degradation strip: the four counts that should make an operator
 * look. Every cell is a measured count over a stated window, so a zero here is
 * a real all-clear rather than missing data — which is why the tile says so
 * out loud instead of leaving four bare zeros to be read either way.
 */
export function AnomalyTile({ anomaly }: { anomaly: AnomalyStrip }) {
  const { t } = useTranslation();
  const b = t.agents.brain;
  const cells = [
    {
      id: 'failed-streak',
      label: b.anomaly_failed_streak,
      hint: b.anomaly_failed_streak_hint,
      value: anomaly.failedStreak,
    },
    {
      id: 'refused-today',
      label: b.anomaly_refused_today,
      hint: b.anomaly_refused_today_hint,
      value: anomaly.refusedToday,
    },
    {
      id: 'open-disputes',
      label: b.anomaly_open_disputes,
      hint: b.anomaly_open_disputes_hint,
      value: anomaly.openDisputes,
    },
    {
      id: 'rejected-drafts',
      label: b.anomaly_rejected_drafts,
      hint: b.anomaly_rejected_drafts_hint,
      value: anomaly.rejectedDrafts7d,
    },
  ];
  const clear = cells.every((c) => c.value === 0);

  return (
    <SectionCard
      title={b.anomaly_title}
      icon={
        clear ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-status-success" aria-hidden />
        ) : (
          <AlertTriangle className="w-3.5 h-3.5 text-status-warning" aria-hidden />
        )
      }
      status={clear ? undefined : 'warning'}
    >
      <div data-testid="brain-anomaly">
        <ul className="grid grid-cols-2 gap-2">
          {cells.map((c) => (
            <li key={c.id}>
              <Tooltip content={c.hint}>
                <div
                  className={`rounded-input border px-2.5 py-2 ${
                    c.value > 0
                      ? 'border-status-warning/40 bg-status-warning/10'
                      : 'border-primary/10 bg-secondary/20'
                  }`}
                  data-testid={`brain-anomaly-${c.id}`}
                >
                  <Numeric
                    className={`typo-heading ${c.value > 0 ? 'text-status-warning' : 'text-foreground/85'}`}
                    value={c.value}
                    unit="plain"
                  />
                  <p className="typo-caption text-foreground/85 mt-0.5">{c.label}</p>
                </div>
              </Tooltip>
            </li>
          ))}
        </ul>
        <p className="mt-2 typo-caption text-foreground/85">
          {clear ? b.anomaly_all_clear : b.anomaly_act}
        </p>
      </div>
    </SectionCard>
  );
}
