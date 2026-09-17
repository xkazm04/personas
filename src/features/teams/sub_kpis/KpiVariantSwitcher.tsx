import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { useTranslation } from '@/i18n/useTranslation';

import { KPI_VARIANTS, type KpiVariant } from './kpiVariant';

/** The six-way pill above every KPI overview renderer. Persisted by the
 *  dispatcher (`kpi-variant` in safeLocalStorage). */
export function KpiVariantSwitcher({
  variant,
  onChange,
}: {
  variant: KpiVariant;
  onChange: (next: KpiVariant) => void;
}) {
  const { t } = useTranslation();
  const o = t.kpis.overview;
  return (
    <div data-testid="kpi-variant-switcher">
      <SegmentedTabs<KpiVariant>
        tabs={KPI_VARIANTS.map((id) => ({ id, label: o.variant_labels[id], testId: `kpi-variant-${id}` }))}
        activeTab={variant}
        onTabChange={onChange}
        ariaLabel={o.variant_switcher_aria}
        size="sm"
        fullWidth={false}
      />
    </div>
  );
}
