import { Suspense, useCallback, useState } from "react";

import { SuspenseFallback } from "@/features/shared/components/feedback/SuspenseFallback";
import { lazyRetry } from "@/lib/lazyRetry";
import { safeLocalGet, safeLocalSet } from "@/lib/safeLocalStorage";

import { DriveVariantSwitcher } from "./DriveVariantSwitcher";

// Drive ships two renderers over ONE engine (useDrive / signing / OCR /
// knowledge hooks + the Rust sandbox): the original "classic" UI, kept
// byte-for-byte, and the from-scratch "finder" shell. The operator compares
// them live through the switcher in each page header; the loser is deleted
// in a later consolidation round (drive-finder spark, 2026-09-17).
const DriveClassicPage = lazyRetry(() => import("./classic/DriveClassicPage"));
const FinderPage = lazyRetry(() => import("./finder/FinderPage"));

export type DriveVariant = "classic" | "finder";

const VARIANT_KEY = "drive-variant";
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

export default function DrivePage() {
  const [variant, setVariant] = useDriveVariant();
  const switcher = (
    <DriveVariantSwitcher variant={variant} onChange={setVariant} />
  );
  return (
    <Suspense fallback={<SuspenseFallback />}>
      {variant === "classic" ? (
        <DriveClassicPage variantSwitcher={switcher} />
      ) : (
        <FinderPage variantSwitcher={switcher} />
      )}
    </Suspense>
  );
}
