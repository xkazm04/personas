import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

export interface TierConfig {
  tier_name: string;
  event_source_max: number;
  webhook_trigger_max: number;
  max_queue_depth: number;
}

export interface RateBucketUsage {
  key: string;
  current: number;
  limit: number;
  percent: number;
}

export interface TierUsageSnapshot {
  tier: TierConfig;
  rate_buckets: RateBucketUsage[];
  total_running: number;
  total_queued: number;
  max_queue_depth: number;
  approaching_limit: boolean;
}

export function getTierUsage(): Promise<TierUsageSnapshot> {
  return invoke<TierUsageSnapshot>("get_tier_usage");
}
