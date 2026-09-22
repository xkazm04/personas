import type { ReactNode } from 'react';

import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { useTranslation } from '@/i18n/useTranslation';

import { KPI_VARIANTS, type KpiVariant } from './kpiVariant';

/** Shared by the switcher (tabs) and the dispatcher (the one tabpanel). */
export const KPI_VARIANT_TAB_PREFIX = 'kpi-variant';

/** The three-way pill above every KPI overview renderer, and the ONE tabpanel
 *  it selects (`children`) — strip and panel live together so the tablist's
 *  aria-controls resolves. Persisted by the dispatcher (`kpi-variant`). */
export function KpiVariantSwitcher({
  variant,
  onChange,
  children,
}: {
  variant: KpiVariant;
  onChange: (next: KpiVariant) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const o = t.kpis.overview;
  return (
    <div className="space-y-4">
      <div data-testid="kpi-variant-switcher">
      <SegmentedTabs<KpiVariant>
        tabs={KPI_VARIANTS.map((id) => ({ id, label: o.variant_labels[id], testId: `kpi-variant-${id}` }))}
        activeTab={variant}
        onTabChange={onChange}
        ariaLabel={o.variant_switcher_aria}
        idPrefix={KPI_VARIANT_TAB_PREFIX}
        size="sm"
        fullWidth={false}
      />
      </div>
      <div
        role="tabpanel"
        id={`${KPI_VARIANT_TAB_PREFIX}-panel-${variant}`}
        aria-labelledby={`${KPI_VARIANT_TAB_PREFIX}-tab-${variant}`}
      >
        {children}
      </div>
    </div>
  );
}
