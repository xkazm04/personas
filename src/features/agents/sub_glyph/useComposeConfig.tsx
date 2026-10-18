/** useComposeConfig — shared compose-phase configuration backbone.
 *
 *  Every compose surface (today: the build sheet, Sheet · Cinema) gathers the
 *  SAME pre-launch preferences — What/When/Apps/Events/Memory/
 *  Review/Messages — through the SAME picker modals, and augments the launch
 *  intent identically. Only the VISUAL arrangement of those affordances is the
 *  design differentiator. This hook owns all of that plumbing so a variant is
 *  just a layout over `items` + `modals`.
 *
 *  Returns:
 *   • items    — one ComposeConfigItem per configurable dimension, each with a
 *                live active/summary read, an onClick that toggles or opens
 *                the right picker, and the shared quick-setup controller.
 *                A dimension's label, icon and colour come from `DIM_META` /
 *                `useGlyphDimText`, not from here.
 *   • modals   — the wired picker modals; drop once into the surface.
 *   • launch   — intent augmented with memory/review preferences, then fired.
 */
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { GlyphDimension } from "@/features/shared/glyph";
import type {
  Frequency, QuickConfigState, EventSubscription,
} from "@/features/agents/shared/quickConfig/quickConfigTypes";
import {
  describeTriggerConfig, describeSelectedConnectors,
} from "@/features/agents/shared/quickConfig/quickConfigTypes";
import { useHealthyConnectors } from "@/features/agents/shared/quickConfig/useHealthyConnectors";
import type { ChannelSpecV2 } from "@/lib/bindings/ChannelSpecV2";
import { ComposerEventPickerModal } from "./commandPanel/composer/ComposerEventPickerModal";
import { ComposerConnectorsPickerModal } from "./commandPanel/composer/ComposerConnectorsPickerModal";
import { ComposerSchedulePickerModal } from "./commandPanel/composer/ComposerSchedulePickerModal";
import { ComposerMessagingPickerModal } from "./commandPanel/composer/ComposerMessagingPickerModal";
import { BUILT_IN_INBOX } from "./commandPanel/messagingChannelDefaults";

/** A configurable compose dimension, ready to render as a chip/node/row. */
export interface ComposeConfigItem {
  /** The glyph dimension this maps to (drives color/petal). */
  dim: GlyphDimension;
  /** "toggle" flips a boolean; "picker" opens a modal; "input" shows the prompt. */
  kind: "toggle" | "picker" | "input";
  /** True when the user has set a non-default value for this dimension. */
  active: boolean;
  /** One-line human read of the current value (empty ⇒ "not set"). */
  summary: string[];
  onClick: () => void;
  /** Inline quick-setup controller shared by every item (optional, additive):
   *  the same state the picker modals write, exposed so a surface can offer
   *  one-click picks without opening a modal. */
  quick?: ComposeQuickSetup;
}

/** The compose-time quick config plus direct setters. Every setter writes the
 *  same state the picker modals write, so onQuickConfigChange fires as usual. */
export interface ComposeQuickSetup {
  config: QuickConfigState;
  setSchedule: (next: { frequency: Frequency | null; days: string[]; monthDay: number; time: string }) => void;
  toggleConnector: (name: string) => void;
  setConnectorTables: (name: string, tables: string[]) => void;
  toggleEvent: (sub: EventSubscription) => void;
  /** Adds or removes a channel by type + credential. The built-in inbox stays pinned. */
  toggleChannel: (spec: ChannelSpecV2) => void;
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

/** The channels a fresh composer starts with: the caller's, inbox pinned first. */
function initialChannels(initial: ChannelSpecV2[] | undefined): ChannelSpecV2[] {
  if (!initial || initial.length === 0) return [BUILT_IN_INBOX];
  return initial.some((s) => s.type === "built-in") ? initial : [BUILT_IN_INBOX, ...initial];
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
  const [selectedChannels, setSelectedChannels] = useState<ChannelSpecV2[]>(() =>
    initialChannels(initialNotificationChannels),
  );
  // The reset below re-derives from the CURRENT initial channels without
  // making them a reset trigger: only a session change resets the composer.
  const initialChannelsRef = useRef(initialNotificationChannels);
  initialChannelsRef.current = initialNotificationChannels;

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
    setSelectedChannels(initialChannels(initialChannelsRef.current));
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

  const quick: ComposeQuickSetup = useMemo(() => ({
    config: {
      frequency, days, monthDay, time,
      selectedConnectors, connectorTables, selectedEvents,
      notificationChannels: selectedChannels,
    },
    setSchedule: (next) => {
      setFrequency(next.frequency);
      setDays(next.days.length > 0 ? next.days : ["mon"]);
      setMonthDay(next.monthDay);
      setTime(next.time);
    },
    toggleConnector: (name) => {
      setSelectedConnectors((prev) => {
        if (!prev.includes(name)) return [...prev, name];
        // Deselecting drops any table scope it carried (same as the picker).
        setConnectorTables((tbl) => {
          if (!(name in tbl)) return tbl;
          const nextTbl = { ...tbl };
          delete nextTbl[name];
          return nextTbl;
        });
        return prev.filter((n) => n !== name);
      });
    },
    setConnectorTables: (name, tables) => {
      setConnectorTables((prev) => {
        const nextTbl = { ...prev };
        // [] = all tables = no filter; only a non-empty subset is persisted.
        if (tables.length > 0) nextTbl[name] = tables; else delete nextTbl[name];
        return nextTbl;
      });
    },
    toggleEvent: (sub) => {
      setSelectedEvents((prev) => {
        const hit = prev.some((e) => e.personaId === sub.personaId && e.triggerId === sub.triggerId);
        return hit
          ? prev.filter((e) => !(e.personaId === sub.personaId && e.triggerId === sub.triggerId))
          : [...prev, sub];
      });
    },
    toggleChannel: (spec) => {
      if (spec.type === "built-in") return;
      setSelectedChannels((prev) => {
        const hit = prev.some((c) => c.type === spec.type && c.credential_id === spec.credential_id);
        const next = hit
          ? prev.filter((c) => !(c.type === spec.type && c.credential_id === spec.credential_id))
          : [...prev, spec];
        return next.some((c) => c.type === "built-in") ? next : [BUILT_IN_INBOX, ...next];
      });
    },
  }), [frequency, days, monthDay, time, selectedConnectors, connectorTables, selectedEvents, selectedChannels]);

  const items: ComposeConfigItem[] = useMemo(() => { const base: ComposeConfigItem[] = [
    {
      dim: "task", kind: "input",
      active: showInput && intentText.trim().length > 0,
      summary: intentText.trim() ? [intentText.trim()] : [],
      onClick: () => setShowInput((v) => !v),
    },
    {
      dim: "trigger", kind: "picker",
      active: frequency != null,
      summary: triggerSummary(),
      onClick: () => setScheduleModalOpen(true),
    },
    {
      dim: "connector", kind: "picker",
      active: selectedConnectors.length > 0,
      summary: connectorSummary(),
      onClick: () => setConnectorsModalOpen(true),
    },
    {
      dim: "event", kind: "picker",
      active: selectedEvents.length > 0,
      summary: selectedEvents.map((e) => `${e.description} (from ${e.personaName})`),
      onClick: () => setEventsModalOpen(true),
    },
    {
      dim: "memory", kind: "toggle",
      active: memoryEnabled,
      summary: memoryEnabled ? ["Remembers preferences between runs"] : [],
      onClick: () => setMemoryEnabled((v) => !v),
    },
    {
      dim: "review", kind: "toggle",
      active: reviewEnabled,
      summary: reviewEnabled ? ["Waits for your approval before publishing"] : [],
      onClick: () => setReviewEnabled((v) => !v),
    },
    {
      dim: "message", kind: "picker",
      active: selectedChannels.some((c) => c.type !== "built-in"),
      summary: selectedChannels
        .filter((c) => c.type !== "built-in")
        .map((c) => c.type),
      onClick: () => setMessagingModalOpen(true),
    },
  ]; return base.map((it) => ({ ...it, quick })); }, [showInput, intentText, frequency, triggerSummary, selectedConnectors, connectorSummary,
      selectedEvents, memoryEnabled, reviewEnabled, selectedChannels, quick]);

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
    launch,
  };
}
