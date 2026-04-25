/**
 * Composer command panel — "Atelier" (v5).
 *
 * Two phases share one panel, switched by a header stepper:
 *   1. Compose — five chronological prompt rows + inline modal pickers
 *      (Schedule / Connectors / Events).
 *   2. Refine  — the LLM's mid-build questions, rendered with the same
 *      row rhythm as Compose so the two phases feel like one continuous
 *      surface (which is what they are: the user keeps shaping intent).
 *
 * Outer panel adopts the Q&A card identity: clean `bg-card-bg`, top accent
 * gradient bar, soft primary halo. Inner rows reuse the Compose rhythm so
 * the visual switch between steps is rhythmic, not jarring.
 *
 * Auto-jumps to Refine when a new question arrives. User can step back to
 * Compose at any time to see / amend the original intent.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, ArrowUp, ListTodo, Calendar, MessageSquare,
  Plug, UserCheck, Clock, Zap, X, HelpCircle, Send, Hash,
  Pencil, CheckCircle2,
} from "lucide-react";
import { useHealthyConnectors } from "@/features/agents/components/matrix/useHealthyConnectors";
import type { Frequency, QuickConfigState, EventSubscription } from "@/features/agents/components/matrix/quickConfigTypes";
import type { BuildQuestion } from "@/lib/types/buildTypes";
import { DIM_META } from "@/features/shared/glyph";
import type { GlyphDimension } from "@/features/shared/glyph";
import { VaultConnectorPicker } from "@/features/shared/components/picker/VaultConnectorPicker";
import { useSystemStore } from "@/stores/systemStore";
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
// Q&A — cell key → glyph dimension (drives icon + tint per question)
// ---------------------------------------------------------------------------

const CELL_KEY_TO_DIM: Record<string, GlyphDimension> = {
  "use-cases": "task",
  connectors: "connector",
  triggers: "trigger",
  "human-review": "review",
  messages: "message",
  memory: "memory",
  "error-handling": "error",
  events: "event",
};

const CELL_KEY_LABEL: Record<string, string> = {
  "use-cases": "Task",
  connectors: "Tools",
  triggers: "When",
  "human-review": "Review",
  messages: "Output",
  memory: "Memory",
  "error-handling": "Errors",
  events: "Events",
};

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
// Shared row shell (used by Compose and Refine)
// ---------------------------------------------------------------------------

interface RowProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  iconColor?: string;
  children: React.ReactNode;
  alignTop?: boolean;
}
function Row({ icon: Icon, label, iconColor, children, alignTop }: RowProps) {
  return (
    <div className={`flex gap-4 py-3.5 border-b border-border/15 last:border-0 ${alignTop ? "items-start" : "items-center"}`}>
      <div className={`shrink-0 w-24 flex items-center gap-1.5 typo-label text-foreground ${alignTop ? "pt-2" : ""}`}>
        <Icon className="w-3.5 h-3.5" style={{ color: iconColor ?? "var(--color-primary)" }} />
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
// Stepper
// ---------------------------------------------------------------------------

interface StepperProps {
  step: 1 | 2;
  pendingCount: number;
  hasComposeContent: boolean;
  onStep: (step: 1 | 2) => void;
}
function Stepper({ step, pendingCount, hasComposeContent, onStep }: StepperProps) {
  const refineDisabled = pendingCount === 0;
  return (
    <div className="flex items-center gap-3" data-testid="composer-stepper">
      <button
        type="button"
        onClick={() => onStep(1)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all ${
          step === 1
            ? "bg-primary/25 border-primary/50 text-foreground"
            : "bg-foreground/5 border-border/30 text-foreground/80 hover:text-foreground hover:border-primary/30"
        }`}
        data-testid="composer-step-compose"
      >
        <span
          className={`w-5 h-5 rounded-full flex items-center justify-center typo-caption font-bold ${
            step === 1 ? "bg-primary text-white" : "bg-foreground/10 text-foreground/80"
          }`}
        >
          {hasComposeContent && step !== 1 ? <CheckCircle2 className="w-3.5 h-3.5" /> : "1"}
        </span>
        <span className="typo-body font-medium">Compose</span>
      </button>
      <span className="w-6 h-px bg-border/50" aria-hidden />
      <button
        type="button"
        onClick={() => !refineDisabled && onStep(2)}
        disabled={refineDisabled}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all disabled:cursor-not-allowed ${
          step === 2
            ? "bg-primary/25 border-primary/50 text-foreground"
            : refineDisabled
              ? "bg-foreground/[0.02] border-border/20 text-foreground/40"
              : "bg-foreground/5 border-border/30 text-foreground/80 hover:text-foreground hover:border-primary/30"
        }`}
        data-testid="composer-step-refine"
      >
        <span
          className={`w-5 h-5 rounded-full flex items-center justify-center typo-caption font-bold ${
            step === 2 ? "bg-primary text-white" : refineDisabled ? "bg-foreground/5 text-foreground/40" : "bg-foreground/10 text-foreground/80"
          }`}
        >
          2
        </span>
        <span className="typo-body font-medium">Refine</span>
        {pendingCount > 0 && (
          <span
            className={`px-1.5 py-0.5 rounded-full typo-caption font-bold tabular-nums ${
              step === 2 ? "bg-primary/30 text-foreground" : "bg-amber-400/25 text-amber-200"
            }`}
            style={{ boxShadow: step === 2 ? undefined : "0 0 8px rgba(251,191,36,0.4)" }}
          >
            {pendingCount}
          </span>
        )}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Refine — Q&A row
// ---------------------------------------------------------------------------

interface QuestionRowProps {
  question: BuildQuestion;
  onAnswer: (cellKey: string, answer: string) => void;
}
function QuestionRow({ question, onAnswer }: QuestionRowProps) {
  const [text, setText] = useState("");
  const dim = CELL_KEY_TO_DIM[question.cellKey];
  const meta = dim ? DIM_META[dim] : undefined;
  const color = meta?.color ?? "var(--color-primary)";
  const Icon = meta?.icon ?? HelpCircle;
  const label = CELL_KEY_LABEL[question.cellKey] ?? question.cellKey.replace(/-/g, " ");
  const options = question.options ?? [];
  const category = question.connectorCategory ?? null;

  const submit = (v: string) => {
    const trimmed = v.trim();
    if (!trimmed) return;
    onAnswer(question.cellKey, trimmed);
    setText("");
  };

  return (
    <Row icon={Icon} label={label} iconColor={color} alignTop>
      <div className="flex flex-col gap-2.5">
        <p className="typo-body-lg text-foreground leading-snug">{question.question}</p>

        {category ? (
          <VaultConnectorPicker
            category={category}
            value=""
            onChange={(serviceType) => submit(serviceType)}
            onAddFromCatalog={() => useSystemStore.getState().setSidebarSection("credentials")}
          />
        ) : (
          <>
            {options.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {options.map((opt, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => submit(opt)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-primary/10 hover:bg-primary/20 border border-card-border hover:border-primary/40 typo-body text-foreground transition-colors cursor-pointer"
                  >
                    <Hash className="w-3 h-3 text-foreground/55" />
                    <span className="tabular-nums text-foreground/55">{i + 1}</span>
                    <span>{opt}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(text); } }}
                placeholder="Answer in your own words…"
                className="flex-1 min-w-0 px-3 py-2 rounded-interactive bg-primary/5 border border-card-border typo-body text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-primary/40"
              />
              <button
                type="button"
                onClick={() => submit(text)}
                disabled={!text.trim()}
                className="px-3 py-2 rounded-interactive bg-primary/25 hover:bg-primary/40 border border-primary/40 typo-body text-foreground disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" />
                Send
              </button>
            </div>
          </>
        )}
      </div>
    </Row>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function CommandPanelComposer({
  intentText, onIntentChange, onLaunch, launchDisabled, onKeyDown, onQuickConfigChange,
  pendingQuestions, onAnswer,
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

  // Stepper state
  const [step, setStep] = useState<1 | 2>(1);
  const pendingCount = pendingQuestions?.length ?? 0;
  const hasComposeContent = useMemo(
    () => Object.values(draft).some((v) => v.trim().length > 0),
    [draft],
  );

  // Auto-jump to Refine when a question arrives. Reset to Compose when
  // there are no pending questions and the user is still pre-build.
  const prevPendingCount = useRef(pendingCount);
  useEffect(() => {
    if (pendingCount > 0 && prevPendingCount.current === 0) {
      setStep(2);
    } else if (pendingCount === 0 && prevPendingCount.current > 0) {
      setStep(1);
    }
    prevPendingCount.current = pendingCount;
  }, [pendingCount]);

  // Modal state
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

  const healthyConnectors = useHealthyConnectors();
  const setRow = (k: IntentKey, v: string) => setDraft((p) => ({ ...p, [k]: v }));

  const scheduleLabel = scheduleSummary(frequency, days, monthDay, time);

  const connectorChips = useMemo(
    () =>
      selectedConnectors.map((name) => {
        const h = healthyConnectors.find((hc) => hc.name === name);
        return { name, label: h?.meta.label ?? name, color: h?.meta.color, iconUrl: h?.meta.iconUrl };
      }),
    [selectedConnectors, healthyConnectors],
  );

  return (
    <div className="w-full min-w-[912px] 2xl:min-w-[1296px] 3xl:min-w-[1608px] max-w-[1800px] relative">
      {/* Soft primary halo behind the panel */}
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
        className="relative flex flex-col rounded-modal border border-card-border bg-card-bg shadow-elevation-2 overflow-hidden"
        style={{ boxShadow: "0 0 22px rgba(96,165,250,0.16), 0 4px 18px rgba(0,0,0,0.18)" }}
      >
        {/* Top accent bar — Q&A-style identity */}
        <div
          aria-hidden
          className="absolute top-0 left-0 w-full h-1"
          style={{
            background: "linear-gradient(90deg, var(--color-primary, #60a5fa), transparent)",
          }}
        />

        {/* Header — title + stepper */}
        <div className="flex items-center justify-between gap-3 px-5 md:px-6 pt-5 md:pt-6 pb-2">
          <div className="flex items-center gap-2 text-foreground font-semibold">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="typo-heading-sm">
              {step === 1 ? "Design your agent" : "Refine your agent"}
            </span>
          </div>
          <Stepper
            step={step}
            pendingCount={pendingCount}
            hasComposeContent={hasComposeContent}
            onStep={setStep}
          />
        </div>
        <p className="px-5 md:px-6 pb-3 typo-caption text-foreground/80">
          {step === 1
            ? "Fill the rows that apply. Attach a schedule, apps, or events with the pickers."
            : "The agent has follow-up questions. Answer in place — your earlier intent is preserved."}
        </p>

        {/* Body — animated step swap */}
        <AnimatePresence mode="wait">
          {step === 1 ? (
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
                    <Row key={row.key} icon={row.icon} label={row.label} alignTop>
                      <div className="flex flex-col gap-2">
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
            </motion.div>
          ) : (
            <motion.div
              key="refine"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
              transition={{ duration: 0.2 }}
              className="px-5 md:px-6 pb-2"
              data-testid="composer-refine"
            >
              {pendingQuestions && pendingQuestions.length > 0 && onAnswer ? (
                pendingQuestions.map((q) => (
                  <QuestionRow key={q.cellKey} question={q} onAnswer={onAnswer} />
                ))
              ) : (
                <div className="py-8 flex flex-col items-center gap-2 text-center">
                  <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                  <p className="typo-body text-foreground/85">
                    No follow-up questions right now.
                  </p>
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="typo-caption text-primary hover:underline"
                  >
                    Back to Compose →
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer */}
        <div className="border-t border-border/25 bg-foreground/[0.03] px-5 md:px-6 py-3 flex items-center justify-between gap-3">
          {step === 1 ? (
            <>
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
            </>
          ) : (
            <>
              <span className="typo-caption text-foreground/75">
                Answer the questions above. The agent picks up your changes immediately.
              </span>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-interactive bg-foreground/5 hover:bg-foreground/10 border border-border/30 typo-caption text-foreground/85 hover:text-foreground transition-colors"
              >
                <Pencil className="w-3 h-3" />
                Edit original
              </button>
            </>
          )}
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
