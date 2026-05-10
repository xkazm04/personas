/**
 * CommandPanelComposer — "Atelier" (v6, compose-only).
 *
 * Five chronological prompt rows + inline modal pickers (Schedule /
 * Connectors / Events). The panel is only mounted during the Compose
 * phase — once the build starts, mid-build follow-up questions are
 * answered by clicking the affected petal on the Glyph (see
 * GlyphFullLayout). This keeps the answer surface unified.
 *
 * Outer panel adopts the Q&A card identity: clean `bg-card-bg`, top accent
 * gradient bar, soft primary halo.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { Frequency, QuickConfigState, EventSubscription } from "@/features/agents/components/matrix/quickConfigTypes";
import type { RecipeMatch } from "@/lib/bindings/RecipeMatch";
import { getRecipe } from "@/api/recipes/recipes";
import { useTranslation } from "@/i18n/useTranslation";
import { useToastStore } from "@/stores/toastStore";
import { useSystemStore } from "@/stores/systemStore";
import { usePipelineStore } from "@/stores/pipelineStore";
import { toastCatch } from "@/lib/silentCatch";
import type { CommandPanelProps } from "./types";
import { CommandPanelFooter } from "./CommandPanelFooter";
import { CommandPanelComposeStep } from "./CommandPanelComposeStep";
import {
  parseIntent, composeIntent, scheduleSummary, mergeRecipeIntoDraft,
  type IntentDraft, type IntentKey,
} from "./commandPanelHelpers";
import { ComposerSchedulePickerModal } from "./composer/ComposerSchedulePickerModal";
import { ComposerConnectorsPickerModal } from "./composer/ComposerConnectorsPickerModal";
import { ComposerEventPickerModal } from "./composer/ComposerEventPickerModal";
import { ComposerRecipeSuggestion } from "./composer/ComposerRecipeSuggestion";

export function CommandPanelComposer({
  intentText, onIntentChange, onLaunch, launchDisabled, onKeyDown, onQuickConfigChange,
  isBuilding,
}: CommandPanelProps) {
  const { t, tx } = useTranslation();
  const [draft, setDraft] = useState<IntentDraft>(() => parseIntent(intentText));
  const [frequency, setFrequency] = useState<Frequency | null>(null);
  const [time, setTime] = useState("09:00");
  const [days, setDays] = useState<string[]>(["mon"]);
  const [monthDay, setMonthDay] = useState(1);
  const [selectedConnectors, setSelectedConnectors] = useState<string[]>([]);
  const [selectedEvents, setSelectedEvents] = useState<EventSubscription[]>([]);

  const [schedOpen, setSchedOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);

  // Propagate composed intent upward (skip first run).
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) { isFirstRun.current = false; return; }
    onIntentChange(composeIntent(draft));
  }, [draft, onIntentChange]);

  // Propagate structured setup upward.
  useEffect(() => {
    if (!onQuickConfigChange) return;
    const next: QuickConfigState = {
      frequency, days, monthDay, time,
      selectedConnectors, connectorTables: {},
      selectedEvents,
    };
    onQuickConfigChange(next);
  }, [frequency, days, monthDay, time, selectedConnectors, selectedEvents, onQuickConfigChange]);

  const setRow = (k: IntentKey, v: string) => setDraft((p) => ({ ...p, [k]: v }));
  const scheduleLabel = scheduleSummary(frequency, days, monthDay, time);

  // Stage D Phase 3 — mode 1 acceptance: fetch the matched recipe and pre-fill
  // the draft. Async errors land in the standard toast/Sentry pipeline.
  const handleApplyRecipe = useCallback(async (match: RecipeMatch) => {
    try {
      const recipe = await getRecipe(match.recipe_id);
      setDraft((prev) => mergeRecipeIntoDraft(prev, recipe));
      useToastStore.getState().addToast(
        tx(t.recipes.composer_suggestion.applied_toast, { name: recipe.name }),
        "success",
      );
    } catch (err) {
      toastCatch("CommandPanelComposer.applyRecipe")(err);
    }
  }, [t, tx]);

  // Stage D Phase 5 — mode 2 acceptance ("Run now" / skip-build).
  // Hands off to the recipes panel: stash the recipe id, switch the
  // sidebar to design-reviews, and let RecipeManager auto-open the
  // playground. The chip never gets here unless the server-side
  // mode_2_eligible gate has flipped, so this is the explicit
  // skip-build path the gate authorises.
  const handleRunDirect = useCallback((match: RecipeMatch) => {
    usePipelineStore.getState().setPendingPlayground(match.recipe_id);
    useSystemStore.getState().setSidebarSection("design-reviews");
    useToastStore.getState().addToast(
      tx(t.recipes.composer_suggestion.run_now_toast, { name: match.recipe_name }),
      "success",
    );
  }, [t, tx]);

  return (
    <div className="w-full min-w-[640px] md:min-w-[800px] lg:min-w-[912px] 2xl:min-w-[1296px] 3xl:min-w-[1608px] max-w-[1800px] relative">
      <div
        aria-hidden
        className="absolute -inset-6 rounded-modal pointer-events-none opacity-60"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 40%, rgba(96,165,250,0.18), transparent 70%)",
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8, scale: 0.97 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="relative flex flex-col rounded-modal border border-card-border bg-card-bg shadow-elevation-2 overflow-hidden"
        style={{ boxShadow: "0 0 22px rgba(96,165,250,0.16), 0 4px 18px rgba(0,0,0,0.18)" }}
      >
        <div
          aria-hidden
          className="absolute top-0 left-0 w-full h-1"
          style={{
            background: "linear-gradient(90deg, var(--color-primary, #60a5fa), transparent)",
          }}
        />

        <CommandPanelComposeStep
          draft={draft}
          setRow={setRow}
          onKeyDown={onKeyDown}
          scheduleLabel={scheduleLabel}
          selectedEvents={selectedEvents}
          selectedConnectors={selectedConnectors}
          setFrequency={setFrequency}
          setSelectedEvents={setSelectedEvents}
          setSelectedConnectors={setSelectedConnectors}
          onOpenSchedule={() => setSchedOpen(true)}
          onOpenEvents={() => setEventsOpen(true)}
          onOpenTools={() => setToolsOpen(true)}
        />

        <ComposerRecipeSuggestion
          task={draft.task}
          onApply={handleApplyRecipe}
          onRunDirect={handleRunDirect}
        />

        <CommandPanelFooter
          launchDisabled={launchDisabled}
          onLaunch={onLaunch}
          isBuilding={isBuilding}
        />
      </motion.div>

      <ComposerSchedulePickerModal
        open={schedOpen}
        onClose={() => setSchedOpen(false)}
        frequency={frequency}
        days={days}
        monthDay={monthDay}
        time={time}
        onApply={(next) => {
          setFrequency(next.frequency);
          setDays(next.days);
          setMonthDay(next.monthDay);
          setTime(next.time);
          setSchedOpen(false);
        }}
      />
      <ComposerConnectorsPickerModal
        open={toolsOpen}
        onClose={() => setToolsOpen(false)}
        selected={selectedConnectors}
        onApply={(next) => {
          setSelectedConnectors(next);
          setToolsOpen(false);
        }}
      />
      <ComposerEventPickerModal
        open={eventsOpen}
        onClose={() => setEventsOpen(false)}
        selected={selectedEvents}
        onApply={(next) => {
          setSelectedEvents(next);
          setEventsOpen(false);
        }}
      />
    </div>
  );
}
