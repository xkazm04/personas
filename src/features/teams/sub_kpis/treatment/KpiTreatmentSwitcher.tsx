// The SECOND axis of the KPI overview: theme x visual treatment.
//
// The first axis (Map / Ledger / River) is a product decision and ships. This
// one is a design review surface: it swaps the visual EXECUTION of whichever
// theme is already selected and changes nothing about where the regions sit,
// what they show or what a click does. It exists so the owner can compare the
// nine treatments against the baseline in the running app, and it is gated to
// dev builds by a named module constant rather than a brace at the render
// site (`inline-dev-build-gate`).
//
// No Web Storage: the selection is session state held by the dispatcher, so a
// user never inherits a reviewer's pick and the default is always the baseline.
import type { ReactNode } from 'react';

import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';

import type { KpiVariant } from '../kpiVariant';
import type { KpiTreatmentId } from './kpiTreatment';
import { TREATMENTS_FOR } from './KpiTreatmentContext';

/** Dev builds only - a visual-review control is not product surface. */
export const SHOW_KPI_TREATMENT_AXIS = import.meta.env.DEV;

const TAB_PREFIX = 'kpi-treatment';
/** Not translated on purpose: a dev-only review control must not spend 14
 *  locales on nine design-position names. */
const AXIS_LABEL = 'Visual treatment (dev)';

/** Title-case a treatment id for the strip - the ids ARE the design-position
 *  names, so there is nothing to look up. */
function labelOf(id: KpiTreatmentId): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

export function KpiTreatmentSwitcher({
  variant,
  treatmentId,
  onChange,
  children,
}: {
  variant: KpiVariant;
  treatmentId: KpiTreatmentId;
  onChange: (next: KpiTreatmentId) => void;
  children: ReactNode;
}) {
  if (!SHOW_KPI_TREATMENT_AXIS) return <>{children}</>;

  const offered = TREATMENTS_FOR[variant];
  const active = offered.find((tr) => tr.id === treatmentId) ?? offered[0]!;

  return (
    <div className="space-y-3" data-testid="kpi-treatment-switcher">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <SegmentedTabs<KpiTreatmentId>
          tabs={offered.map((tr) => ({
            id: tr.id,
            label: labelOf(tr.id),
            testId: `kpi-treatment-${tr.id}`,
          }))}
          activeTab={active.id}
          onTabChange={onChange}
          ariaLabel={AXIS_LABEL}
          idPrefix={TAB_PREFIX}
          size="sm"
          fullWidth={false}
        />
        <p className="typo-caption">{active.thesis}</p>
      </div>
      <div
        role="tabpanel"
        id={`${TAB_PREFIX}-panel-${active.id}`}
        aria-labelledby={`${TAB_PREFIX}-tab-${active.id}`}
      >
        {children}
      </div>
    </div>
  );
}
