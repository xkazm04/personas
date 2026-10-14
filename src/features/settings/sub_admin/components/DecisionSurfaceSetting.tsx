/**
 * The `decisionSurface` dev switch (spark mandate-lanes): Chips, the
 * Decision Center's seven-kind strip, or Lanes, the four mandate lanes plus
 * Orphans with the Stewards plate and the mandate register. It lives in the
 * dev-only Admin tab until the owner approves lanes for daily use; every
 * reader follows the store, so it switches at once, with no reload.
 */
import { Route } from 'lucide-react';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';

export function DecisionSurfaceSetting() {
  const { t } = useTranslation();
  const m = t.monitor;
  const surface = useSystemStore((s) => s.decisionSurface);
  const setSurface = useSystemStore((s) => s.setDecisionSurface);
  return (
    <SectionCard
      title={m.ml_setting_title}
      subtitle={m.ml_setting_hint}
      icon={<Route className="h-4 w-4 text-primary" aria-hidden />}
      titleClassName="text-primary"
      action={
        <span className="flex items-center gap-2">
          <span className="typo-caption" data-testid="decision-surface-value">
            {surface === 'lanes' ? m.ml_setting_lanes : m.ml_setting_chips}
          </span>
          <AccessibleToggle
            checked={surface === 'lanes'}
            onChange={() => setSurface(surface === 'lanes' ? 'chips' : 'lanes')}
            label={m.ml_setting_title}
            data-testid="decision-surface-toggle"
          />
        </span>
      }
    >
      {null}
    </SectionCard>
  );
}
