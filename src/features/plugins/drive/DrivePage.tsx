import { Suspense, useCallback, useState } from "react";

import { SuspenseFallback } from "@/features/shared/components/feedback/SuspenseFallback";
import { lazyRetry } from "@/lib/lazyRetry";
import { safeLocalGet, safeLocalSet } from "@/lib/safeLocalStorage";

import { SegmentedTabs } from "@/features/shared/components/layout/SegmentedTabs";
import { useTranslation } from "@/i18n/useTranslation";

// Drive ships two renderers over ONE engine (useDrive / signing / OCR /
// knowledge hooks + the Rust sandbox): the original "classic" UI, kept
// byte-for-byte, and the from-scratch "finder" shell. The operator compares
// them live through the switcher in each page header; the loser is deleted
// in a later consolidation round (drive-finder spark, 2026-09-17).
const DriveClassicPage = lazyRetry(() => import("./classic/DriveClassicPage"));
const FinderPage = lazyRetry(() => import("./finder/FinderPage"));

export type DriveVariant = "classic" | "finder";

const VARIANT_KEY = "drive-variant";
const VARIANT_TABS_PREFIX = "drive-variant";
const DEFAULT_VARIANT: DriveVariant = "finder";

function readVariant(): DriveVariant {
  const raw = safeLocalGet(VARIANT_KEY, "drive:variant");
  return raw === "classic" || raw === "finder" ? raw : DEFAULT_VARIANT;
}

export function useDriveVariant(): [DriveVariant, (next: DriveVariant) => void] {
  const [variant, setVariantState] = useState<DriveVariant>(readVariant);
  const setVariant = useCallback((next: DriveVariant) => {
    safeLocalSet(VARIANT_KEY, next, "drive:variant");
    setVariantState(next);
  }, []);
  return [variant, setVariant];
}

/**
 * Classic | Finder pill shown in the page header of BOTH renderers so the
 * comparison is one click away from either side. The rendered variant is the
 * strip's tabpanel (same file, so aria-controls resolves).
 */
export default function DrivePage() {
  const { t } = useTranslation();
  const f = t.plugins.drive.finder;
  const [variant, setVariant] = useDriveVariant();
  const switcher = (
    <div data-testid="drive-variant-switcher">
      <SegmentedTabs<DriveVariant>
        idPrefix={VARIANT_TABS_PREFIX}
        tabs={[
          { id: "classic", label: f.variant_classic, testId: "drive-variant-classic" },
          { id: "finder", label: f.variant_finder, testId: "drive-variant-finder" },
        ]}
        activeTab={variant}
        onTabChange={setVariant}
        ariaLabel={f.variant_switcher_aria}
        size="sm"
        fullWidth={false}
      />
    </div>
  );
  return (
    <div
      className="contents"
      role="tabpanel"
      id={`${VARIANT_TABS_PREFIX}-panel-${variant}`}
      aria-labelledby={`${VARIANT_TABS_PREFIX}-tab-${variant}`}
    >
      <Suspense fallback={<SuspenseFallback />}>
        {variant === "classic" ? (
          <DriveClassicPage variantSwitcher={switcher} />
        ) : (
          <FinderPage variantSwitcher={switcher} />
        )}
      </Suspense>
    </div>
  );
}
