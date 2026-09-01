import type { CapabilityState } from "@/lib/types/buildTypes";
import type { Translations } from "@/i18n/en";
import { interpolate } from "@/i18n/useTranslation";
import { humanizeCron } from "@/features/shared/glyph/cron";
import { prettyTriggerType } from "@/features/shared/glyph/triggers";

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return `uc_${slug || `cap_${Date.now().toString(36)}`}`;
}

/**
 * One-line, localized trigger summary for the collapsed row chip. Mirrors the
 * sibling `GlyphCapabilityPreview` summary: schedules defer to `humanizeCron`,
 * polling interpolates the interval, everything else falls back to the
 * localized type (plus the user-authored blurb when there is one).
 *
 * The polling interval lives under `config.interval_seconds` — that is the key
 * the backend trigger validator (`commands/tools/triggers.rs`) and the glyph
 * preview both read. This used to read `config.interval`, which never exists,
 * so every polling capability summarised as the literal token "polling".
 */
export function triggerSummary(t: Translations, cap: CapabilityState): string {
  const trig = cap.suggested_trigger;
  if (!trig) return "";
  const cfg = trig.config ?? {};
  const cron = typeof cfg.cron === "string" ? cfg.cron : undefined;
  const interval = typeof cfg.interval_seconds === "number" ? cfg.interval_seconds : undefined;
  if (trig.trigger_type === "schedule" && cron) return humanizeCron(t, cron);
  if (trig.trigger_type === "polling" && interval) {
    return interpolate(t.agents.glyph_cap_trigger_polling, { seconds: interval });
  }
  const label = prettyTriggerType(t, trig.trigger_type);
  return trig.description ? `${label} — ${trig.description}` : label;
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
