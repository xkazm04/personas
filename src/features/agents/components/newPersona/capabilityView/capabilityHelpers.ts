import type { CapabilityState } from "@/lib/types/buildTypes";

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return `uc_${slug || `cap_${Date.now().toString(36)}`}`;
}

export function triggerSummary(cap: CapabilityState): string {
  const trig = cap.suggested_trigger;
  if (!trig) return "";
  const cfg = (trig.config ?? {}) as Record<string, unknown>;
  if (trig.trigger_type === "schedule" || trig.trigger_type === "polling") {
    return String(cfg.cron ?? cfg.interval ?? trig.trigger_type);
  }
  return trig.description ?? trig.trigger_type;
}

export const TRACKED_FIELDS = [
  "suggested_trigger",
  "connectors",
  "notification_channels",
  "review_policy",
  "memory_policy",
  "event_subscriptions",
] as const;

export function resolutionProgress(cap: CapabilityState): { resolved: number; total: number } {
  const total = TRACKED_FIELDS.length;
  const resolved = TRACKED_FIELDS.reduce(
    (acc, f) => acc + (cap.resolvedFields[f] === "resolved" ? 1 : 0),
    0,
  );
  return { resolved, total };
}

export function isResolved(cap: CapabilityState, field: string): boolean {
  return cap.resolvedFields[field] === "resolved";
}
