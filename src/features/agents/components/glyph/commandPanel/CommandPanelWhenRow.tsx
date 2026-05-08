import { Clock, Zap, X } from "lucide-react";
import type { Frequency, EventSubscription } from "@/features/agents/components/matrix/quickConfigTypes";
import { CommandPanelRow, CommandPanelAttachButton } from "./CommandPanelRow";
import type { IntentRowDef } from "./commandPanelHelpers";

interface CommandPanelWhenRowProps {
  rowDef: IntentRowDef;
  draftValue: string;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => void;
  scheduleLabel: string | null;
  selectedEvents: EventSubscription[];
  setFrequency: (f: Frequency | null) => void;
  setSelectedEvents: React.Dispatch<React.SetStateAction<EventSubscription[]>>;
  onOpenSchedule: () => void;
  onOpenEvents: () => void;
}

export function CommandPanelWhenRow({
  rowDef, draftValue, onChange, onKeyDown,
  scheduleLabel, selectedEvents,
  setFrequency, setSelectedEvents,
  onOpenSchedule, onOpenEvents,
}: CommandPanelWhenRowProps) {
  const handleClearSchedule = () => setFrequency(null);
  const handleClearScheduleKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      handleClearSchedule();
    }
  };
  const removeSelectedEvent = (sub: EventSubscription) => {
    setSelectedEvents((prev) => prev.filter((e2) => !(e2.personaId === sub.personaId && e2.triggerId === sub.triggerId)));
  };
  const handleRemoveEventKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>, sub: EventSubscription) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      removeSelectedEvent(sub);
    }
  };

  return (
    <CommandPanelRow icon={rowDef.icon} label={rowDef.label} alignTop>
      <div className="flex flex-col gap-2">
        {(scheduleLabel || selectedEvents.length > 0) && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {scheduleLabel && (
              <button
                type="button"
                onClick={onOpenSchedule}
                className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-primary/20 border border-primary/40 typo-caption text-foreground hover:bg-primary/30 transition-colors"
              >
                <Clock className="w-3 h-3" />
                {scheduleLabel}
                <span
                  onClick={(e) => { e.stopPropagation(); handleClearSchedule(); }}
                  onKeyDown={handleClearScheduleKeyDown}
                  role="button"
                  tabIndex={0}
                  aria-label="Clear schedule"
                  className="text-foreground/60 hover:text-foreground -mr-0.5 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </span>
              </button>
            )}
            {selectedEvents.map((sub) => (
              <button
                key={`${sub.personaId}:${sub.triggerId}`}
                type="button"
                onClick={onOpenEvents}
                className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-primary/20 border border-primary/40 typo-caption text-foreground hover:bg-primary/30 transition-colors max-w-[320px]"
              >
                <Zap className="w-3 h-3" />
                <span className="truncate">{sub.personaName} · {sub.description}</span>
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSelectedEvent(sub);
                  }}
                  onKeyDown={(e) => handleRemoveEventKeyDown(e, sub)}
                  role="button"
                  tabIndex={0}
                  aria-label="Remove subscription"
                  className="text-foreground/60 hover:text-foreground -mr-0.5 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={draftValue}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={rowDef.placeholder}
            data-testid="composer-row-when"
            className="flex-1 min-w-0 bg-transparent typo-body-lg text-foreground placeholder:text-foreground/35 placeholder:italic focus:outline-none"
          />
          <CommandPanelAttachButton icon={Clock} active={!!scheduleLabel} onClick={onOpenSchedule}>
            Schedule
          </CommandPanelAttachButton>
          <CommandPanelAttachButton icon={Zap} active={selectedEvents.length > 0} onClick={onOpenEvents}>
            Event
          </CommandPanelAttachButton>
        </div>
      </div>
    </CommandPanelRow>
  );
}
