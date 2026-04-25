/**
 * Composer command panel — "Atelier" (v4).
 *
 * Five chronological prompt rows flow like a spell the user composes:
 *   Task · When · Output · Tools · Review
 *
 * Structured setup is not a second section — it lives inside the relevant
 * rows as ambient "attach" buttons that open focused modal pickers:
 *
 *   · When  → SchedulePickerModal   (rhythm cards → detail step)
 *   · When  → EventPickerModal      (persona list → event templates)
 *   · Tools → ConnectorsPickerModal (search + categories + grid)
 *
 * Attachments surface as beautiful chips back on the row — schedule chip,
 * connector chip (with brand logo), event chip (with persona avatar). All
 * dismissible without opening the modal again.
 *
 * Keyboard: Enter submits; Shift+Enter newlines; Esc closes modals;
 * ⌘/Ctrl+Enter inside a modal applies that picker's selection.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Sparkles, ArrowUp, ListTodo, Calendar, MessageSquare,
  Plug, UserCheck, Clock, Zap, X,
} from "lucide-react";
import { useHealthyConnectors } from "@/features/agents/components/matrix/useHealthyConnectors";
import type { Frequency, QuickConfigState, EventSubscription } from "@/features/agents/components/matrix/quickConfigTypes";
import type { CommandPanelProps } from "./types";
import { SchedulePickerModal } from "./composer/SchedulePickerModal";
import { ConnectorsPickerModal } from "./composer/ConnectorsPickerModal";
import { EventPickerModal } from "./composer/EventPickerModal";
import { BrandIcon } from "./composer/BrandIcon";

// ---------------------------------------------------------------------------
// Prompt rows
// ---------------------------------------------------------------------------

type IntentKey = "task" | "when" | "output" | "tools" | "review";
type IntentDraft = Record<IntentKey, string>;

interface IntentRowDef {
  key: IntentKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  placeholder: string;
  multiline: boolean;
  composeLabel: string;
}

const INTENT_ROWS: IntentRowDef[] = [
  { key: "task",   label: "Task",   icon: ListTodo,     placeholder: "Summarize incoming support emails and extract customer intent.",        multiline: true,  composeLabel: "Task" },
  { key: "when",   label: "When",   icon: Calendar,     placeholder: "Every weekday at 9am — or when a new Slack message mentions @support.", multiline: false, composeLabel: "When" },
  { key: "output", label: "Output", icon: MessageSquare, placeholder: "A ranked list of issues posted to the engineering Slack channel.",     multiline: true,  composeLabel: "Output" },
  { key: "tools",  label: "Tools",  icon: Plug,         placeholder: "Gmail, Slack, Notion.",                                                 multiline: false, composeLabel: "Tools" },
  { key: "review", label: "Review", icon: UserCheck,    placeholder: "Only items marked high priority or containing customer PII.",          multiline: false, composeLabel: "Human review" },
];

const EMPTY_DRAFT: IntentDraft = { task: "", when: "", output: "", tools: "", review: "" };

function composeIntent(draft: IntentDraft): string {
  const parts: string[] = [];
  for (const row of INTENT_ROWS) {
    const v = draft[row.key].trim();
    if (!v) continue;
    parts.push(`${row.composeLabel}: ${v}`);
  }
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Schedule serializer for chip label
// ---------------------------------------------------------------------------

const DAY_SHORT: Record<string, string> = {
  mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun",
};

function scheduleSummary(freq: Frequency | null, days: string[], monthDay: number, time: string): string | null {
  if (freq === null) return null;
  const t = time || "09:00";
  if (freq === "daily") return `Daily · ${t}`;
  if (freq === "weekly") {
    const labels = days.map((d) => DAY_SHORT[d]).filter(Boolean).join("/");
    return `${labels || "—"} · ${t}`;
  }
  return `Day ${monthDay} · ${t}`;
}

// ---------------------------------------------------------------------------
// Shared row shell
// ---------------------------------------------------------------------------

interface RowProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
  alignTop?: boolean;
}
function Row({ icon: Icon, label, children, alignTop }: RowProps) {
  return (
    <div className={`flex gap-4 py-3.5 border-b border-border/15 last:border-0 ${alignTop ? "items-start" : "items-center"}`}>
      <div className={`shrink-0 w-24 flex items-center gap-1.5 typo-label text-foreground ${alignTop ? "pt-2" : ""}`}>
        <Icon className="w-3.5 h-3.5 text-primary/80" />
        {label}
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function AttachButton({ icon: Icon, active, onClick, children }: {
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-interactive border transition-all ${
        active
          ? "bg-primary/20 border-primary/50 text-foreground"
          : "bg-foreground/5 border-border/30 text-foreground/85 hover:border-primary/40 hover:text-foreground hover:bg-primary/10"
      }`}
      style={active ? { boxShadow: "0 0 12px rgba(96,165,250,0.25)" } : undefined}
    >
      <Icon className="w-3.5 h-3.5" />
      <span className="typo-caption font-medium">{children}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main Composer
// ---------------------------------------------------------------------------

export function CommandPanelComposer({
  intentText, onIntentChange, onLaunch, launchDisabled, onKeyDown, onQuickConfigChange,
}: CommandPanelProps) {
  const [draft, setDraft] = useState<IntentDraft>(() =>
    intentText ? { ...EMPTY_DRAFT, task: intentText } : EMPTY_DRAFT,
  );
  const [frequency, setFrequency] = useState<Frequency | null>(null);
  const [time, setTime] = useState("09:00");
  const [days, setDays] = useState<string[]>(["mon"]);
  const [monthDay, setMonthDay] = useState(1);
  const [selectedConnectors, setSelectedConnectors] = useState<string[]>([]);
  const [selectedEvents, setSelectedEvents] = useState<EventSubscription[]>([]);

  // Which modal is open
  const [schedOpen, setSchedOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);

  // Propagate composed intent upward (skip initial mount).
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

  const healthyConnectors = useHealthyConnectors();
  const setRow = (k: IntentKey, v: string) => setDraft((p) => ({ ...p, [k]: v }));

  const scheduleLabel = scheduleSummary(frequency, days, monthDay, time);

  // Rich chip data for Tools row
  const connectorChips = useMemo(
    () =>
      selectedConnectors.map((name) => {
        const h = healthyConnectors.find((hc) => hc.name === name);
        return { name, label: h?.meta.label ?? name, color: h?.meta.color, iconUrl: h?.meta.iconUrl };
      }),
    [selectedConnectors, healthyConnectors],
  );

  return (
    <div className="w-full min-w-[760px] 2xl:min-w-[1080px] 3xl:min-w-[1340px] max-w-[1500px] relative">
      {/* Ambient primary halo */}
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
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="relative flex flex-col rounded-modal border border-card-border bg-gradient-to-br from-card-bg via-card-bg/85 to-primary/[0.06] backdrop-blur-lg shadow-elevation-3 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-5 md:px-6 pt-5 md:pt-6 pb-1 text-foreground font-semibold">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="typo-heading-sm">Design your agent</span>
        </div>
        <p className="px-5 md:px-6 pb-3 typo-caption text-foreground/80">
          Fill the rows that apply. Attach a schedule, apps, or events with the pickers.
        </p>

        {/* Intent rows */}
        <div className="px-5 md:px-6 pb-2">
          {INTENT_ROWS.map((row) => {
            if (row.key === "when") {
              return (
                <Row key={row.key} icon={row.icon} label={row.label} alignTop>
                  <div className="flex flex-col gap-2">
                    {/* Chips above input — always visible when attachments exist */}
                    {(scheduleLabel || selectedEvents.length > 0) && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {scheduleLabel && (
                          <button
                            type="button"
                            onClick={() => setSchedOpen(true)}
                            className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-primary/20 border border-primary/40 typo-caption text-foreground hover:bg-primary/30 transition-colors"
                          >
                            <Clock className="w-3 h-3" />
                            {scheduleLabel}
                            <span
                              onClick={(e) => { e.stopPropagation(); setFrequency(null); }}
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
                            onClick={() => setEventsOpen(true)}
                            className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-primary/20 border border-primary/40 typo-caption text-foreground hover:bg-primary/30 transition-colors max-w-[320px]"
                          >
                            <Zap className="w-3 h-3" />
                            <span className="truncate">{sub.personaName} · {sub.description}</span>
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedEvents((prev) => prev.filter((e2) => !(e2.personaId === sub.personaId && e2.triggerId === sub.triggerId)));
                              }}
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
                        value={draft.when}
                        onChange={(e) => setRow("when", e.target.value)}
                        onKeyDown={onKeyDown}
                        placeholder={row.placeholder}
                        data-testid="composer-row-when"
                        className="flex-1 min-w-0 bg-transparent typo-body-lg text-foreground placeholder:text-foreground/35 placeholder:italic focus:outline-none"
                      />
                      <AttachButton icon={Clock} active={!!scheduleLabel} onClick={() => setSchedOpen(true)}>
                        Schedule
                      </AttachButton>
                      <AttachButton icon={Zap} active={selectedEvents.length > 0} onClick={() => setEventsOpen(true)}>
                        Event
                      </AttachButton>
                    </div>
                  </div>
                </Row>
              );
            }

            if (row.key === "tools") {
              return (
                <Row key={row.key} icon={row.icon} label={row.label} alignTop>
                  <div className="flex flex-col gap-2">
                    {/* Attached connector chips with brand logos */}
                    {connectorChips.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {connectorChips.map((c) => (
                          <span
                            key={c.name}
                            className="flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-full bg-primary/20 border border-primary/40 typo-caption text-foreground"
                            style={c.color ? { boxShadow: `0 0 10px ${c.color}26` } : undefined}
                          >
                            <span
                              className="inline-flex w-5 h-5 rounded-full items-center justify-center overflow-hidden shrink-0"
                              style={{ background: c.color ? `${c.color}26` : undefined }}
                            >
                              {c.iconUrl && c.color ? (
                                <BrandIcon iconUrl={c.iconUrl} color={c.color} size={14} />
                              ) : (
                                <Plug className="w-3 h-3" style={{ color: c.color }} />
                              )}
                            </span>
                            {c.label}
                            <button
                              type="button"
                              onClick={() => setSelectedConnectors((p) => p.filter((n) => n !== c.name))}
                              aria-label={`Remove ${c.label}`}
                              className="text-foreground/60 hover:text-foreground"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={draft.tools}
                        onChange={(e) => setRow("tools", e.target.value)}
                        onKeyDown={onKeyDown}
                        placeholder={row.placeholder}
                        data-testid="composer-row-tools"
                        className="flex-1 min-w-0 bg-transparent typo-body-lg text-foreground placeholder:text-foreground/35 placeholder:italic focus:outline-none"
                      />
                      <AttachButton icon={Plug} active={selectedConnectors.length > 0} onClick={() => setToolsOpen(true)}>
                        {selectedConnectors.length === 0
                          ? "Pick from vault"
                          : `${selectedConnectors.length} attached`}
                      </AttachButton>
                    </div>
                  </div>
                </Row>
              );
            }

            // Default rows (Task, Output, Review)
            return (
              <Row key={row.key} icon={row.icon} label={row.label} alignTop={row.multiline}>
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
              </Row>
            );
          })}
        </div>

        {/* Footer */}
        <div className="border-t border-border/25 bg-foreground/[0.03] px-5 md:px-6 py-3 flex items-center justify-between gap-3">
          <span className="typo-caption text-foreground/75">
            <kbd className="font-medium text-foreground/90">Enter</kbd> to summon ·{" "}
            <kbd className="font-medium text-foreground/90">Shift + Enter</kbd> for a new line
          </span>
          <button
            type="button"
            onClick={onLaunch}
            disabled={launchDisabled}
            data-testid="agent-launch-btn"
            aria-label="Summon agent"
            className="w-10 h-10 shrink-0 rounded-full bg-primary/30 hover:bg-primary/50 border border-primary/50 text-foreground disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center transition-all"
            style={{ boxShadow: "0 0 22px rgba(96,165,250,0.3)" }}
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        </div>
      </motion.div>

      {/* Modals */}
      <SchedulePickerModal
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
      <ConnectorsPickerModal
        open={toolsOpen}
        onClose={() => setToolsOpen(false)}
        selected={selectedConnectors}
        onApply={(next) => {
          setSelectedConnectors(next);
          setToolsOpen(false);
        }}
      />
      <EventPickerModal
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
