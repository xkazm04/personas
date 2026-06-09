import { Layers, Clock, Webhook, MousePointer, Radio, Shield, Brain, X, Split, Undo2 } from "lucide-react";
import { useAgentStore } from "@/stores/agentStore";
import { useShallow } from "zustand/react/shallow";
import { humanizeCron } from "@/features/shared/glyph/cron";
import { getConnectorMeta, ConnectorIcon } from "@/features/shared/components/display/ConnectorMeta";
import { Tooltip } from "@/features/shared/components/display/Tooltip";
import { useTranslation } from "@/i18n/useTranslation";
import { DebtText, debtText } from '@/i18n/DebtText';


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

type TriggerLike = { trigger_type?: string; config?: Record<string, unknown>; description?: string } | undefined | null;

function reviewTone(mode: string | undefined): "muted" | "warn" {
  switch ((mode || "").toLowerCase()) {
    case "always":
    case "auto_triage":
    case "on_low_confidence":
      return "warn";
    default:
      return "muted";
  }
}

function buildSplitPrompt(title: string, connectors: string[]): string {
  if (connectors.length >= 2) {
    return `Split the "${title}" capability into ${connectors.length} separate capabilities — one per source: ${connectors.join(", ")}. Each new capability should have its own trigger, its own review/memory policy, and emit a completion event the original digest capability listens for to assemble its output. Remove the consolidated version.`;
  }
  return `Split the "${title}" capability into smaller, independently-toggleable pieces. Describe how the work should be divided so I can disable any one piece without losing the others.`;
}

export function GlyphCapabilityPreview({ onRequestSplit }: GlyphCapabilityPreviewProps = {}) {
  const { t, tx } = useTranslation();
  const { capabilities, capabilityOrder, excludedIds, toggleCapabilityExcluded, behaviorCore } = useAgentStore(
    useShallow((s) => {
      const sess = s.activeBuildSessionId
        ? s.buildSessions[s.activeBuildSessionId]
        : null;
      return {
        capabilities: sess?.capabilities ?? {},
        capabilityOrder: sess?.capabilityOrder ?? [],
        excludedIds: sess?.excludedCapabilityIds ?? [],
        toggleCapabilityExcluded: s.toggleCapabilityExcluded,
        behaviorCore: sess?.behaviorCore ?? null,
      };
    }),
  );

  if (capabilityOrder.length === 0) return null;

  const excludedSet = new Set(excludedIds);
  const activeCount = capabilityOrder.length - excludedSet.size;

  // Localized review-policy label. Falls back to the raw mode token for an
  // unrecognised policy so we never render an empty chip.
  const reviewLabel = (mode: string | undefined): string => {
    switch ((mode || "").toLowerCase()) {
      case "always": return t.agents.glyph_cap_review_always;
      case "auto_triage": return t.agents.glyph_cap_review_auto_triage;
      case "on_low_confidence": return t.agents.glyph_cap_review_low_confidence;
      case "never":
      case "": return t.agents.glyph_cap_review_auto_publish;
      default: return mode || "—";
    }
  };

  // Localized one-line trigger summary. Schedule rows defer to humanizeCron
  // (locale-agnostic), polling interpolates the interval, and everything
  // else falls back to the capitalised type + its (user-authored) blurb.
  const triggerSummary = (trig: TriggerLike): string => {
    const triggerType = trig?.trigger_type;
    if (!triggerType) return t.agents.glyph_cap_trigger_manual;
    const cron = (trig?.config?.cron as string | undefined) || undefined;
    const interval = (trig?.config?.interval_seconds as number | undefined) || undefined;
    if (triggerType === "schedule" && cron) return humanizeCron(cron);
    if (triggerType === "polling" && interval) return tx(t.agents.glyph_cap_trigger_polling, { seconds: interval });
    const capitalised = `${triggerType.charAt(0).toUpperCase()}${triggerType.slice(1)}`;
    if (trig?.description && trig.description.length < 60) return `${capitalised} — ${trig.description}`;
    return capitalised;
  };

  return (
    <div className="w-full max-w-[420px] flex flex-col gap-1.5 mt-2">
      <div className="flex items-center gap-1.5 px-1">
        <Layers className="w-3.5 h-3.5 text-foreground" />
        <span className="typo-label uppercase tracking-[0.18em] text-foreground">
          {activeCount === 1
            ? t.agents.glyph_cap_count_one
            : tx(t.agents.glyph_cap_count_other, { count: activeCount })}
          {excludedSet.size > 0 && (
            <span className="ml-1 text-foreground normal-case tracking-normal">
              ({excludedSet.size} <DebtText k="auto_removed_7a8146f4" />
            </span>
          )}
        </span>
      </div>
      {/* Pre-promote confirmation: surface the behavior core (what the persona IS)
          so the user can catch a misframed mission/role before committing. */}
      {behaviorCore?.mission && (
        <div className="rounded-modal border border-border/30 bg-foreground/5 px-3 py-2">
          {behaviorCore.identity?.role && (
            <div className="typo-caption uppercase tracking-[0.16em] text-foreground mb-0.5 truncate">
              {behaviorCore.identity.role}
            </div>
          )}
          <div className="typo-body text-foreground/90 leading-snug">{behaviorCore.mission}</div>
        </div>
      )}
      <div className="flex flex-col gap-1 max-h-[400px] overflow-y-auto pr-1">
        {capabilityOrder.map((id) => {
          const cap = capabilities[id];
          if (!cap) return null;
          const isExcluded = excludedSet.has(id);
          const triggerType = cap.suggested_trigger?.trigger_type ?? "manual";
          const TriggerIcon = TRIGGER_ICONS[triggerType] ?? MousePointer;
          const reviewMode = cap.review_policy?.mode;
          const tone = reviewTone(reviewMode);
          const memoryEnabled = !!cap.memory_policy?.enabled;
          const connectorList = cap.connectors ?? [];
          const events = cap.event_subscriptions ?? [];
          return (
            <div
              key={id}
              className={`rounded-modal border px-3 py-2 text-left transition ${
                isExcluded
                  ? "bg-foreground/0 border-border/20 opacity-50"
                  : "bg-foreground/5 border-border/30 hover:border-border/50 hover:bg-foreground/[0.08]"
              }`}
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className={`typo-body truncate ${isExcluded ? "text-foreground line-through" : "text-foreground/90"}`}>
                    {cap.title || id}
                  </div>
                  {isExcluded ? (
                    <div className="mt-1 typo-caption text-foreground">
                      <DebtText k="auto_will_not_be_promoted_7a454132" />
                    </div>
                  ) : (
                    <div className="mt-1 flex items-center gap-2 flex-wrap typo-caption text-foreground">
                      <span className="inline-flex items-center gap-1">
                        <TriggerIcon className="w-3 h-3" />
                        {triggerSummary(cap.suggested_trigger)}
                      </span>
                      {connectorList.length > 0 && (
                        <Tooltip content={connectorList.join(", ")}>
                          <span className="inline-flex items-center gap-1">
                            {connectorList.slice(0, 4).map((slug) => (
                              <ConnectorIcon key={slug} meta={getConnectorMeta(slug)} size="w-3.5 h-3.5" />
                            ))}
                            {connectorList.length > 4 ? (
                              <span className="text-foreground">+{connectorList.length - 4}</span>
                            ) : null}
                          </span>
                        </Tooltip>
                      )}
                      <span
                        className={`inline-flex items-center gap-1 ${
                          tone === "warn" ? "text-amber-400/80" : "text-foreground"
                        }`}
                      >
                        <Shield className="w-3 h-3" />
                        {reviewLabel(reviewMode)}
                      </span>
                      {memoryEnabled && (
                        <span className="inline-flex items-center gap-1 text-foreground">
                          <Brain className="w-3 h-3" />
                          {t.agents.glyph_cap_remembers}
                        </span>
                      )}
                      {events.length > 0 && (
                        <Tooltip
                          content={events
                            .map((e) => `${e.direction === "emit" ? "→ " : "← "}${e.event_type}`)
                            .join("\n")}
                        >
                          <span className="inline-flex items-center gap-1 text-foreground">
                            <Radio className="w-3 h-3" />
                            {events.length === 1
                              ? (events[0]?.event_type ?? "").split(".").slice(-2).join(".")
                              : tx(t.agents.glyph_cap_events_other, { count: events.length })}
                          </span>
                        </Tooltip>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  {isExcluded ? (
                    <button
                      type="button"
                      onClick={() => toggleCapabilityExcluded(id)}
                      className="px-2 py-1 rounded-input hover:bg-foreground/10 text-foreground hover:text-foreground typo-caption inline-flex items-center gap-1 cursor-pointer"
                      aria-label={debtText("auto_restore_capability_91a3b415")}
                      title={debtText("auto_restore_include_this_capability_when_promo_e8f43ec9")}
                    >
                      <Undo2 className="w-3 h-3" />
                      {t.agents.glyph_cap_restore}
                    </button>
                  ) : (
                    <>
                      {onRequestSplit && (
                        <button
                          type="button"
                          onClick={() => onRequestSplit(cap.title || id, buildSplitPrompt(cap.title || id, connectorList))}
                          className="px-1.5 py-1 rounded-input hover:bg-primary/10 text-foreground hover:text-primary typo-caption inline-flex items-center gap-1 cursor-pointer"
                          aria-label={debtText("auto_split_this_capability_via_refine_99e725c3")}
                          title={debtText("auto_open_refine_with_a_prompt_that_asks_the_ag_c0e3037e")}
                        >
                          <Split className="w-3 h-3" />
                          {t.agents.glyph_cap_split}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleCapabilityExcluded(id)}
                        className="px-1.5 py-1 rounded-input hover:bg-rose-500/10 text-foreground hover:text-rose-400 typo-caption inline-flex items-center gap-1 cursor-pointer"
                        aria-label={debtText("auto_remove_capability_from_the_promoted_person_a4d121d1")}
                        title={debtText("auto_remove_exclude_this_capability_when_promot_dbf501b9")}
                      >
                        <X className="w-3 h-3" />
                        {t.agents.glyph_cap_remove}
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
