/** useComposeConfig — shared compose-phase configuration backbone.
 *
 *  Every compose-surface prototype (Dialogue, Constellation, the baseline)
 *  gathers the SAME pre-launch preferences — What/When/Apps/Events/Memory/
 *  Review/Messages — through the SAME picker modals, and augments the launch
 *  intent identically. Only the VISUAL arrangement of those affordances is the
 *  design differentiator. This hook owns all of that plumbing so a variant is
 *  just a layout over `items` + `modals`.
 *
 *  Returns:
 *   • items    — one ComposeConfigItem per configurable dimension, each with a
 *                live active/summary read and an onClick that toggles or opens
 *                the right picker. Map over these to render chips/nodes/rows.
 *   • modals   — the wired picker modals; drop once into the surface.
 *   • composeCellStates — synthetic cell map so a shared sigil lights the
 *                petals the user has already set.
 *   • launch   — intent augmented with memory/review preferences, then fired.
 *   • anyActive / quickConfig passthrough.
 */
import { useState, useCallback, useEffect, useMemo } from "react";
import {
  Calendar, ListTodo, Plug, MessageSquare, UserCheck, Brain, Activity,
  type LucideIcon,
} from "lucide-react";
import type { GlyphDimension, GlyphRow, GlyphPresence } from "@/features/shared/glyph";
import { GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import type {
  Frequency, QuickConfigState, EventSubscription,
} from "@/features/agents/shared/quickConfig/quickConfigTypes";
import {
  describeTriggerConfig, describeSelectedConnectors,
} from "@/features/agents/shared/quickConfig/quickConfigTypes";
import { useHealthyConnectors } from "@/features/agents/shared/quickConfig/useHealthyConnectors";
import type { CellBuildStatus } from "@/lib/types/buildTypes";
import type { ChannelSpecV2 } from "@/lib/bindings/ChannelSpecV2";
import { ComposerEventPickerModal } from "./commandPanel/composer/ComposerEventPickerModal";
import { ComposerConnectorsPickerModal } from "./commandPanel/composer/ComposerConnectorsPickerModal";
import { ComposerSchedulePickerModal } from "./commandPanel/composer/ComposerSchedulePickerModal";
import { ComposerMessagingPickerModal } from "./commandPanel/composer/ComposerMessagingPickerModal";

const BUILT_IN_INBOX: ChannelSpecV2 = {
  type: "built-in", enabled: true, credential_id: null,
  use_case_ids: "*", event_filter: null, config: null,
};

/** A configurable compose dimension, ready to render as a chip/node/row. */
export interface ComposeConfigItem {
  /** The glyph dimension this maps to (drives color/petal). */
  dim: GlyphDimension;
  label: string;
  icon: LucideIcon;
  color: string;
  /** "toggle" flips a boolean; "picker" opens a modal; "input" shows the prompt. */
  kind: "toggle" | "picker" | "input";
  /** True when the user has set a non-default value for this dimension. */
  active: boolean;
  /** One-line human read of the current value (empty ⇒ "not set"). */
  summary: string[];
  onClick: () => void;
}

interface UseComposeConfigArgs {
  intentText: string;
  onIntentChange: (v: string) => void;
  onLaunch: () => void;
  onQuickConfigChange?: (c: QuickConfigState) => void;
  initialNotificationChannels?: ChannelSpecV2[];
  /** Reset all local config when the build session identity changes. */
  resetKey: string | null;
  /** Extra directive block (e.g. the persona-core temperament) appended to the
   *  intent right before launch, after the memory/review lines. Empty ⇒ nothing. */
  coreAugmentation?: string;
}

export function useComposeConfig({
  intentText, onIntentChange, onLaunch, onQuickConfigChange,
  initialNotificationChannels, resetKey, coreAugmentation = "",
}: UseComposeConfigArgs) {
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [reviewEnabled, setReviewEnabled] = useState(false);
  const [selectedConnectors, setSelectedConnectors] = useState<string[]>([]);
  // Per-connector DB table scope (connector name → tables; [] / absent = all).
  // Threaded from the connectors picker so a restricted table selection is
  // honored instead of silently granting access to every table.
  const [connectorTables, setConnectorTables] = useState<Record<string, string[]>>({});
  const [selectedEvents, setSelectedEvents] = useState<EventSubscription[]>([]);
  const [frequency, setFrequency] = useState<Frequency | null>(null);
  const [time, setTime] = useState("09:00");
  const [days, setDays] = useState<string[]>(["mon"]);
  const [monthDay, setMonthDay] = useState(1);
  const [showInput, setShowInput] = useState(true);

  const [eventsModalOpen, setEventsModalOpen] = useState(false);
  const [connectorsModalOpen, setConnectorsModalOpen] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [messagingModalOpen, setMessagingModalOpen] = useState(false);
  const [selectedChannels, setSelectedChannels] = useState<ChannelSpecV2[]>(() => {
    if (!initialNotificationChannels || initialNotificationChannels.length === 0) {
      return [BUILT_IN_INBOX];
    }
    const hasBuiltIn = initialNotificationChannels.some((s) => s.type === "built-in");
    return hasBuiltIn ? initialNotificationChannels : [BUILT_IN_INBOX, ...initialNotificationChannels];
  });

  const healthyConnectors = useHealthyConnectors();

  useEffect(() => {
    setMemoryEnabled(false);
    setReviewEnabled(false);
    setSelectedConnectors([]);
    setConnectorTables({});
    setSelectedEvents([]);
    setFrequency(null);
    setTime("09:00");
    setDays(["mon"]);
    setMonthDay(1);
    setShowInput(true);
    setEventsModalOpen(false);
    setConnectorsModalOpen(false);
    setScheduleModalOpen(false);
    setMessagingModalOpen(false);
  }, [resetKey]);

  // Flow local quick-config up so the launch path's serializeQuickConfig
  // appends it to the user's intent (same contract as the baseline).
  useEffect(() => {
    if (!onQuickConfigChange) return;
    onQuickConfigChange({
      frequency, days, monthDay, time,
      selectedConnectors, connectorTables, selectedEvents,
      notificationChannels: selectedChannels,
    });
  }, [frequency, days, monthDay, time, selectedConnectors, connectorTables, selectedEvents, selectedChannels, onQuickConfigChange]);

  // Synthetic cell map — light the petals the user has already configured.
  const composeCellStates = useMemo(() => {
    const next: Record<string, CellBuildStatus> = {};
    if (memoryEnabled) next["memory"] = "resolved";
    if (reviewEnabled) next["human-review"] = "resolved";
    if (selectedConnectors.length > 0) next["connectors"] = "resolved";
    if (selectedEvents.length > 0) { next["events"] = "resolved"; next["triggers"] = "resolved"; }
    if (frequency) next["triggers"] = "resolved";
    if (showInput && intentText.trim()) next["use-cases"] = "resolved";
    return next;
  }, [memoryEnabled, reviewEnabled, selectedConnectors, selectedEvents, frequency, showInput, intentText]);

  const triggerSummary = useCallback((): string[] => {
    if (!frequency) return [];
    return describeTriggerConfig({
      frequency, days, monthDay, time,
      selectedConnectors: [], connectorTables: {}, selectedEvents: [], notificationChannels: [],
    });
  }, [frequency, days, monthDay, time]);

  const connectorSummary = useCallback((): string[] => {
    if (selectedConnectors.length === 0) return [];
    return describeSelectedConnectors({
      frequency: null, days: ["mon"], monthDay: 1, time: "09:00",
      selectedConnectors, connectorTables, selectedEvents: [], notificationChannels: [],
    }, healthyConnectors);
  }, [selectedConnectors, connectorTables, healthyConnectors]);

  const items: ComposeConfigItem[] = useMemo(() => [
    {
      dim: "task", label: "What", icon: ListTodo, color: "#a78bfa", kind: "input",
      active: showInput && intentText.trim().length > 0,
      summary: intentText.trim() ? [intentText.trim()] : [],
      onClick: () => setShowInput((v) => !v),
    },
    {
      dim: "trigger", label: "When", icon: Calendar, color: "#fbbf24", kind: "picker",
      active: frequency != null,
      summary: triggerSummary(),
      onClick: () => setScheduleModalOpen(true),
    },
    {
      dim: "connector", label: "Apps", icon: Plug, color: "#22d3ee", kind: "picker",
      active: selectedConnectors.length > 0,
      summary: connectorSummary(),
      onClick: () => setConnectorsModalOpen(true),
    },
    {
      dim: "event", label: "Events", icon: Activity, color: "#2dd4bf", kind: "picker",
      active: selectedEvents.length > 0,
      summary: selectedEvents.map((e) => `${e.description} (from ${e.personaName})`),
      onClick: () => setEventsModalOpen(true),
    },
    {
      dim: "memory", label: "Memory", icon: Brain, color: "#c084fc", kind: "toggle",
      active: memoryEnabled,
      summary: memoryEnabled ? ["Remembers preferences between runs"] : [],
      onClick: () => setMemoryEnabled((v) => !v),
    },
    {
      dim: "review", label: "Review", icon: UserCheck, color: "#fb7185", kind: "toggle",
      active: reviewEnabled,
      summary: reviewEnabled ? ["Waits for your approval before publishing"] : [],
      onClick: () => setReviewEnabled((v) => !v),
    },
    {
      dim: "message", label: "Messages", icon: MessageSquare, color: "#60a5fa", kind: "picker",
      active: selectedChannels.some((c) => c.type !== "built-in"),
      summary: selectedChannels
        .filter((c) => c.type !== "built-in")
        .map((c) => c.type),
      onClick: () => setMessagingModalOpen(true),
    },
  ], [showInput, intentText, frequency, triggerSummary, selectedConnectors, connectorSummary,
      selectedEvents, memoryEnabled, reviewEnabled, selectedChannels]);

  const anyActive = useMemo(
    () => items.some((i) => i.active),
    [items],
  );

  // Synthetic "forming persona" row — drives a decorative InteractiveSigil so
  // the user sees their agent's dimensional shape fill in as they configure.
  // A configured dimension reads as `linked`; everything else `none`.
  const formingRow: GlyphRow = useMemo(() => {
    const activeDims = new Set<GlyphDimension>(items.filter((i) => i.active).map((i) => i.dim));
    const presence = {} as Record<GlyphDimension, GlyphPresence>;
    for (const d of GLYPH_DIMENSIONS) presence[d] = activeDims.has(d) ? "linked" : "none";
    return {
      id: "forming",
      title: "New agent",
      enabled: true,
      triggers: [], connectors: [], steps: [], events: [],
      presence,
      shared: false,
    };
  }, [items]);

  // Augment the intent with memory/review preferences right before launch —
  // the build prompt's heuristics open/skip those gates from the keywords, so
  // a user who set them in the UI never re-answers them mid-build.
  const launch = useCallback(() => {
    const lines = [
      memoryEnabled
        ? "Memory: yes — remember user preferences and corrections between runs"
        : "Memory: no — each run is independent, no memory needed",
      reviewEnabled
        ? "Review: always wait for my approval before publishing output"
        : "Review: never — automatically publish without asking",
    ];
    onIntentChange(`${intentText}\n---\n${lines.join("\n")}${coreAugmentation}`);
    onLaunch();
  }, [memoryEnabled, reviewEnabled, intentText, onIntentChange, onLaunch, coreAugmentation]);

  const modals = (
    <>
      <ComposerEventPickerModal
        open={eventsModalOpen}
        onClose={() => setEventsModalOpen(false)}
        selected={selectedEvents}
        onApply={(next) => { setSelectedEvents(next); setEventsModalOpen(false); }}
      />
      <ComposerConnectorsPickerModal
        open={connectorsModalOpen}
        onClose={() => setConnectorsModalOpen(false)}
        selected={selectedConnectors}
        tables={connectorTables}
        onApply={(next, tables) => { setSelectedConnectors(next); setConnectorTables(tables); setConnectorsModalOpen(false); }}
      />
      <ComposerSchedulePickerModal
        open={scheduleModalOpen}
        onClose={() => setScheduleModalOpen(false)}
        frequency={frequency}
        days={days}
        monthDay={monthDay}
        time={time}
        onApply={(next) => {
          setFrequency(next.frequency);
          setDays(next.days);
          setMonthDay(next.monthDay);
          setTime(next.time);
          setScheduleModalOpen(false);
        }}
      />
      <ComposerMessagingPickerModal
        open={messagingModalOpen}
        onClose={() => setMessagingModalOpen(false)}
        selected={selectedChannels}
        onApply={(next) => {
          const hasBuiltIn = next.some((s) => s.type === "built-in");
          setSelectedChannels(hasBuiltIn ? next : [BUILT_IN_INBOX, ...next]);
          setMessagingModalOpen(false);
        }}
      />
    </>
  );

  return {
    items,
    modals,
    composeCellStates,
    formingRow,
    launch,
    anyActive,
    showInput,
    setShowInput,
  };
}
