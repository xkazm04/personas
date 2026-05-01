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
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { Frequency, QuickConfigState, EventSubscription } from "@/features/agents/components/matrix/quickConfigTypes";
import type { CommandPanelProps } from "./types";
import { CommandPanelHeader } from "./CommandPanelHeader";
import { CommandPanelFooter } from "./CommandPanelFooter";
import { CommandPanelComposeStep } from "./CommandPanelComposeStep";
import {
  parseIntent, composeIntent, scheduleSummary,
  type IntentDraft, type IntentKey,
} from "./commandPanelHelpers";
import { ComposerSchedulePickerModal } from "./composer/ComposerSchedulePickerModal";
import { ComposerConnectorsPickerModal } from "./composer/ComposerConnectorsPickerModal";
import { ComposerEventPickerModal } from "./composer/ComposerEventPickerModal";

export function CommandPanelComposer({
  intentText, onIntentChange, onLaunch, launchDisabled, onKeyDown, onQuickConfigChange,
}: CommandPanelProps) {
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

  return (
    <div className="w-full min-w-[912px] 2xl:min-w-[1296px] 3xl:min-w-[1608px] max-w-[1800px] relative">
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

        <CommandPanelHeader />

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

        <CommandPanelFooter launchDisabled={launchDisabled} onLaunch={onLaunch} />
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
