import { motion } from "framer-motion";
import type { Frequency, EventSubscription } from "@/features/agents/components/matrix/quickConfigTypes";
import { CommandPanelRow } from "./CommandPanelRow";
import { CommandPanelWhenRow } from "./CommandPanelWhenRow";
import { CommandPanelToolsRow } from "./CommandPanelToolsRow";
import { INTENT_ROWS, type IntentDraft, type IntentKey } from "./commandPanelHelpers";

interface CommandPanelComposeStepProps {
  draft: IntentDraft;
  setRow: (k: IntentKey, v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => void;
  scheduleLabel: string | null;
  selectedEvents: EventSubscription[];
  selectedConnectors: string[];
  setFrequency: (f: Frequency | null) => void;
  setSelectedEvents: React.Dispatch<React.SetStateAction<EventSubscription[]>>;
  setSelectedConnectors: React.Dispatch<React.SetStateAction<string[]>>;
  onOpenSchedule: () => void;
  onOpenEvents: () => void;
  onOpenTools: () => void;
}

export function CommandPanelComposeStep({
  draft, setRow, onKeyDown,
  scheduleLabel, selectedEvents, selectedConnectors,
  setFrequency, setSelectedEvents, setSelectedConnectors,
  onOpenSchedule, onOpenEvents, onOpenTools,
}: CommandPanelComposeStepProps) {
  return (
    <motion.div
      key="compose"
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16 }}
      transition={{ duration: 0.2 }}
      className="px-5 md:px-6 pb-2"
    >
      {INTENT_ROWS.map((row) => {
        if (row.key === "when") {
          return (
            <CommandPanelWhenRow
              key={row.key}
              rowDef={row}
              draftValue={draft.when}
              onChange={(v) => setRow("when", v)}
              onKeyDown={onKeyDown}
              scheduleLabel={scheduleLabel}
              selectedEvents={selectedEvents}
              setFrequency={setFrequency}
              setSelectedEvents={setSelectedEvents}
              onOpenSchedule={onOpenSchedule}
              onOpenEvents={onOpenEvents}
            />
          );
        }

        if (row.key === "tools") {
          return (
            <CommandPanelToolsRow
              key={row.key}
              rowDef={row}
              draftValue={draft.tools}
              onChange={(v) => setRow("tools", v)}
              onKeyDown={onKeyDown}
              selectedConnectors={selectedConnectors}
              setSelectedConnectors={setSelectedConnectors}
              onOpenTools={onOpenTools}
            />
          );
        }

        return (
          <CommandPanelRow key={row.key} icon={row.icon} label={row.label} alignTop={row.multiline}>
            {row.multiline ? (
              <textarea
                value={draft[row.key]}
                onChange={(e) => setRow(row.key, e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={row.placeholder}
                rows={2}
                data-testid={`composer-row-${row.key}`}
                className="w-full bg-transparent typo-body-lg text-foreground placeholder:text-foreground/35 placeholder:italic focus:outline-none resize-none leading-relaxed"
              />
            ) : (
              <input
                type="text"
                value={draft[row.key]}
                onChange={(e) => setRow(row.key, e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={row.placeholder}
                data-testid={`composer-row-${row.key}`}
                className="w-full bg-transparent typo-body-lg text-foreground placeholder:text-foreground/35 placeholder:italic focus:outline-none"
              />
            )}
          </CommandPanelRow>
        );
      })}
    </motion.div>
  );
}
