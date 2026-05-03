import { Layers, Clock, Webhook, MousePointer, Radio, Shield, Brain, Database } from "lucide-react";
import { useAgentStore } from "@/stores/agentStore";
import { useShallow } from "zustand/react/shallow";

/**
 * A-grade Phase 5 (2026-05-03) — capability transparency before promote.
 *
 * Pre-Phase-5 the LLM decided 1-vs-N capability split silently. The user
 * promoted, then later wanted to disable just one source ("don't fetch
 * GitHub this week") and discovered the persona was a single monolith.
 *
 * This panel renders each resolved capability inline above the promote
 * button so the user sees the split (and its trigger / connectors /
 * review / memory shape) BEFORE committing. Read-only for v1 — split /
 * merge edit affordances are tracked separately. Even read-only is the
 * meaningful win: the user now consents to the LLM's structural choice
 * instead of inheriting it.
 */

const TRIGGER_ICONS: Record<string, typeof Clock> = {
  schedule: Clock,
  polling: Clock,
  webhook: Webhook,
  event: Radio,
  event_listener: Radio,
  manual: MousePointer,
};

function shortReviewLabel(mode: string | undefined): { label: string; tone: "muted" | "warn" } {
  switch ((mode || "").toLowerCase()) {
    case "always":
      return { label: "Always review", tone: "warn" };
    case "auto_triage":
      return { label: "Auto-triage", tone: "warn" };
    case "on_low_confidence":
      return { label: "Review if unsure", tone: "warn" };
    case "never":
    case "":
      return { label: "Auto-publish", tone: "muted" };
    default:
      return { label: mode || "—", tone: "muted" };
  }
}

function formatTriggerSummary(trig: { trigger_type?: string; config?: Record<string, unknown>; description?: string } | undefined | null): string {
  if (!trig?.trigger_type) return "Manual";
  const cron = (trig.config?.cron as string | undefined) || undefined;
  const interval = (trig.config?.interval_seconds as number | undefined) || undefined;
  if (trig.trigger_type === "schedule" && cron) return `Schedule (${cron})`;
  if (trig.trigger_type === "polling" && interval) return `Polling every ${interval}s`;
  if (trig.description && trig.description.length < 60) return `${trig.trigger_type[0].toUpperCase()}${trig.trigger_type.slice(1)} — ${trig.description}`;
  return trig.trigger_type[0].toUpperCase() + trig.trigger_type.slice(1);
}

export function GlyphCapabilityPreview() {
  const { capabilities, capabilityOrder } = useAgentStore(
    useShallow((s) => {
      const sess = s.activeBuildSessionId
        ? s.buildSessions[s.activeBuildSessionId]
        : null;
      return {
        capabilities: sess?.capabilities ?? {},
        capabilityOrder: sess?.capabilityOrder ?? [],
      };
    }),
  );

  if (capabilityOrder.length === 0) return null;

  return (
    <div className="w-full max-w-[420px] flex flex-col gap-1.5 mt-2">
      <div className="flex items-center gap-1.5 px-1">
        <Layers className="w-3.5 h-3.5 text-foreground/55" />
        <span className="typo-label uppercase tracking-[0.18em] text-foreground/60">
          {capabilityOrder.length === 1 ? "1 capability" : `${capabilityOrder.length} capabilities`}
        </span>
      </div>
      <div className="flex flex-col gap-1 max-h-[180px] overflow-y-auto pr-1">
        {capabilityOrder.map((id) => {
          const cap = capabilities[id];
          if (!cap) return null;
          const triggerType = cap.suggested_trigger?.trigger_type ?? "manual";
          const TriggerIcon = TRIGGER_ICONS[triggerType] ?? MousePointer;
          const review = shortReviewLabel(cap.review_policy?.mode);
          const memoryEnabled = !!cap.memory_policy?.enabled;
          const connectorList = cap.connectors ?? [];
          return (
            <div
              key={id}
              className="rounded-modal bg-foreground/5 border border-border/30 px-3 py-2 text-left"
            >
              <div className="typo-body text-foreground/90 truncate">
                {cap.title || id}
              </div>
              <div className="mt-1 flex items-center gap-2 flex-wrap typo-caption text-foreground/55">
                <span className="inline-flex items-center gap-1">
                  <TriggerIcon className="w-3 h-3" />
                  {formatTriggerSummary(cap.suggested_trigger)}
                </span>
                {connectorList.length > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <Database className="w-3 h-3" />
                    {connectorList.slice(0, 3).join(", ")}
                    {connectorList.length > 3 ? ` +${connectorList.length - 3}` : ""}
                  </span>
                )}
                <span
                  className={`inline-flex items-center gap-1 ${
                    review.tone === "warn" ? "text-amber-400/80" : "text-foreground/55"
                  }`}
                >
                  <Shield className="w-3 h-3" />
                  {review.label}
                </span>
                {memoryEnabled && (
                  <span className="inline-flex items-center gap-1 text-foreground/55">
                    <Brain className="w-3 h-3" />
                    Remembers
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
