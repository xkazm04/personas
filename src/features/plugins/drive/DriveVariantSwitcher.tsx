import { SegmentedTabs } from "@/features/shared/components/layout/SegmentedTabs";
import { useTranslation } from "@/i18n/useTranslation";

import type { DriveVariant } from "./DrivePage";

/**
 * Classic | Finder pill shown in the page header of BOTH Drive renderers so
 * the comparison is one click away from either side. Persisted by the
 * parent (`drive-variant` in safeLocalStorage).
 */
export function DriveVariantSwitcher({
  variant,
  onChange,
}: {
  variant: DriveVariant;
  onChange: (next: DriveVariant) => void;
}) {
  const { t } = useTranslation();
  const f = t.plugins.drive.finder;
  return (
    <div data-testid="drive-variant-switcher">
      <SegmentedTabs<DriveVariant>
        tabs={[
          { id: "classic", label: f.variant_classic, testId: "drive-variant-classic" },
          { id: "finder", label: f.variant_finder, testId: "drive-variant-finder" },
        ]}
        activeTab={variant}
        onTabChange={onChange}
        ariaLabel={f.variant_switcher_aria}
        size="sm"
        fullWidth={false}
      />
    </div>
  );
}
