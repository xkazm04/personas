import type { OverviewStore } from "../storeTypes";

/** Shared selector: count of non-dismissed alerts. */
export const selectActiveAlertCount = (s: OverviewStore): number => {
  let count = 0;
  for (const a of s.alertHistory) { if (!a.dismissed) count++; }
  return count;
};
