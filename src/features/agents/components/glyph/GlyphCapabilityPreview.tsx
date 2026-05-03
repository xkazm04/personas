import { Layers, Clock, Webhook, MousePointer, Radio, Shield, Brain, Database, X, Split, Undo2 } from "lucide-react";
import { useAgentStore } from "@/stores/agentStore";
import { useShallow } from "zustand/react/shallow";

interface GlyphCapabilityPreviewProps {
  /** A-grade Phase 5b: invoked when the user clicks "Split" on a capability.
   *  Pre-populates the Refine composer with a structured prompt that asks
   *  the LLM to break the capability into independent pieces. The caller
   *  is responsible for opening the composer (setRefining(true)) and
   *  routing the prompt through the existing onRefine path. */
  onRequestSplit?: (capabilityTitle: string, prefilledPrompt: string) => void;
}

/**
 * A-grade Phase 5 (2026-05-03) — capability transparency before promote.
 *
 * Pre-Phase-5 the LLM decided 1-vs-N capability split silently. The user
 * promoted, then later wanted to disable just one source ("don't fetch
 * GitHub this week") and discovered the persona was a single monolith.
 *
 * Phase 5a (read-only): rendered each capability with its trigger /
 * connectors / review / memory shape so the user could see the split.
 *
 * Phase 5b (this revision): adds two interactive controls per capability —
 *   • "Remove" — toggles the capability into the session's
 *     `excludedCapabilityIds` list. Promote-time filters these out via
 *     `promoteBuildDraft(..., excludedUseCaseIds)`. Removed capabilities
 *     render greyed out with "Will not be promoted" and an Undo button
 *     so the user can recover.
 *   • "Split via Refine" — opens the Refine composer with a structured
 *     prompt asking the LLM to split THIS capability across its
 *     connectors. Routes through the existing refine flow which
 *     re-engages the build session.
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
  const triggerType = trig?.trigger_type;
  if (!triggerType) return "Manual";
  const cron = (trig?.config?.cron as string | undefined) || undefined;
  const interval = (trig?.config?.interval_seconds as number | undefined) || undefined;
  if (triggerType === "schedule" && cron) return `Schedule (${cron})`;
  if (triggerType === "polling" && interval) return `Polling every ${interval}s`;
  const capitalised = `${triggerType.charAt(0).toUpperCase()}${triggerType.slice(1)}`;
  if (trig?.description && trig.description.length < 60) return `${capitalised} — ${trig.description}`;
  return capitalised;
}

function buildSplitPrompt(title: string, connectors: string[]): string {
  if (connectors.length >= 2) {
    return `Split the "${title}" capability into ${connectors.length} separate capabilities — one per source: ${connectors.join(", ")}. Each new capability should have its own trigger, its own review/memory policy, and emit a completion event the original digest capability listens for to assemble its output. Remove the consolidated version.`;
  }
  return `Split the "${title}" capability into smaller, independently-toggleable pieces. Describe how the work should be divided so I can disable any one piece without losing the others.`;
}

export function GlyphCapabilityPreview({ onRequestSplit }: GlyphCapabilityPreviewProps = {}) {
  const { capabilities, capabilityOrder, excludedIds, toggleCapabilityExcluded } = useAgentStore(
    useShallow((s) => {
      const sess = s.activeBuildSessionId
        ? s.buildSessions[s.activeBuildSessionId]
        : null;
      return {
        capabilities: sess?.capabilities ?? {},
        capabilityOrder: sess?.capabilityOrder ?? [],
        excludedIds: sess?.excludedCapabilityIds ?? [],
        toggleCapabilityExcluded: s.toggleCapabilityExcluded,
      };
    }),
  );

  if (capabilityOrder.length === 0) return null;

  const excludedSet = new Set(excludedIds);
  const activeCount = capabilityOrder.length - excludedSet.size;

  return (
    <div className="w-full max-w-[420px] flex flex-col gap-1.5 mt-2">
      <div className="flex items-center gap-1.5 px-1">
        <Layers className="w-3.5 h-3.5 text-foreground/55" />
        <span className="typo-label uppercase tracking-[0.18em] text-foreground/60">
          {activeCount === 1 ? "1 capability" : `${activeCount} capabilities`}
          {excludedSet.size > 0 && (
            <span className="ml-1 text-foreground/35 normal-case tracking-normal">
              ({excludedSet.size} removed)
            </span>
          )}
        </span>
      </div>
      <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto pr-1">
        {capabilityOrder.map((id) => {
          const cap = capabilities[id];
          if (!cap) return null;
          const isExcluded = excludedSet.has(id);
          const triggerType = cap.suggested_trigger?.trigger_type ?? "manual";
          const TriggerIcon = TRIGGER_ICONS[triggerType] ?? MousePointer;
          const review = shortReviewLabel(cap.review_policy?.mode);
          const memoryEnabled = !!cap.memory_policy?.enabled;
          const connectorList = cap.connectors ?? [];
          return (
            <div
              key={id}
              className={`rounded-modal border px-3 py-2 text-left transition-opacity ${
                isExcluded
                  ? "bg-foreground/0 border-border/20 opacity-50"
                  : "bg-foreground/5 border-border/30"
              }`}
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className={`typo-body truncate ${isExcluded ? "text-foreground/55 line-through" : "text-foreground/90"}`}>
                    {cap.title || id}
                  </div>
                  {isExcluded ? (
                    <div className="mt-1 typo-caption text-foreground/45">
                      Will not be promoted
                    </div>
                  ) : (
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
                  )}
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  {isExcluded ? (
                    <button
                      type="button"
                      onClick={() => toggleCapabilityExcluded(id)}
                      className="px-2 py-1 rounded-md hover:bg-foreground/10 text-foreground/60 hover:text-foreground typo-caption inline-flex items-center gap-1 cursor-pointer"
                      aria-label="Restore capability"
                      title="Restore — include this capability when promoting"
                    >
                      <Undo2 className="w-3 h-3" />
                      Restore
                    </button>
                  ) : (
                    <>
                      {onRequestSplit && (
                        <button
                          type="button"
                          onClick={() => onRequestSplit(cap.title || id, buildSplitPrompt(cap.title || id, connectorList))}
                          className="px-1.5 py-1 rounded-md hover:bg-primary/10 text-foreground/55 hover:text-primary typo-caption inline-flex items-center gap-1 cursor-pointer"
                          aria-label="Split this capability via Refine"
                          title="Open Refine with a prompt that asks the agent to break this capability into independent pieces"
                        >
                          <Split className="w-3 h-3" />
                          Split
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleCapabilityExcluded(id)}
                        className="px-1.5 py-1 rounded-md hover:bg-rose-500/10 text-foreground/45 hover:text-rose-400 typo-caption inline-flex items-center gap-1 cursor-pointer"
                        aria-label="Remove capability from the promoted persona"
                        title="Remove — exclude this capability when promoting"
                      >
                        <X className="w-3 h-3" />
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
