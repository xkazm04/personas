import type { ReactNode } from 'react';

import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { useTranslation } from '@/i18n/useTranslation';

import {
  KPI_PROTOTYPE_LABELS,
  KPI_SHIPPED_VARIANTS,
  KPI_VARIANTS,
  type KpiVariant,
} from './kpiVariant';

/** Shared by the switcher (tabs) and the dispatcher (the one tabpanel). */
export const KPI_VARIANT_TAB_PREFIX = 'kpi-variant';

/** A shipped variant's label is translated; a prototype under review carries
 *  its concept name untranslated, which is why the lookup is a function and
 *  not an index into `variant_labels` (whose type only knows the three). */
function labelOf(id: KpiVariant, shipped: Record<'map' | 'ledger' | 'river', string>): string {
  return (KPI_SHIPPED_VARIANTS as readonly string[]).includes(id)
    ? shipped[id as 'map' | 'ledger' | 'river']
    : (KPI_PROTOTYPE_LABELS[id] ?? id);
}

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
        tabs={KPI_VARIANTS.map((id) => ({
          id,
          label: labelOf(id, o.variant_labels),
          testId: `kpi-variant-${id}`,
        }))}
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
