import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { TierConfig } from "@/lib/bindings/TierConfig";
import type { RateBucketUsage } from "@/lib/bindings/RateBucketUsage";
import type { TierUsageSnapshot } from "@/lib/bindings/TierUsageSnapshot";
export type { TierConfig, RateBucketUsage, TierUsageSnapshot };

export function getTierUsage(): Promise<TierUsageSnapshot> {
  return invoke<TierUsageSnapshot>("get_tier_usage");
}
