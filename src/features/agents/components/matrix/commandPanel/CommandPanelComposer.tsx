/**
 * Composer command panel — "Chronology" metaphor (v2).
 *
 * Replaces the single big textarea with a 5-row narrative prompt that walks
 * the user chronologically through the shape of their use case:
 *   1. Task    — what needs to happen
 *   2. When    — trigger / schedule (free-text OR structured row below)
 *   3. Output  — what the agent produces
 *   4. Tools   — apps to connect (free-text OR structured row below)
 *   5. Review  — what needs human review
 *
 * Each row shares one visual rhythm (icon · uppercase label · input). Below
 * the 5 prompt rows, two "structured setup" rows use the SAME row pattern so
 * the quick-setup feels native, not forced in:
 *   · Schedule — pill picker (None/Daily/Weekly/Monthly) + time
 *   · Apps     — toggle chips from healthy connectors
 *
 * The 5 prompt rows compose into `intentText` (labelled, newline-separated,
 * blanks skipped). The structured rows drive `onQuickConfigChange` so the
 * existing serializeQuickConfig pipeline still appends its hints at launch.
 *
 * Enter submits from any row; Shift+Enter inserts a newline in textareas.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles, ArrowUp, ListTodo, Calendar, MessageSquare,
  Plug, UserCheck, Clock, Zap,
} from "lucide-react";
import { useHealthyConnectors } from "@/features/agents/components/matrix/useHealthyConnectors";
import type { Frequency, QuickConfigState } from "@/features/agents/components/matrix/quickConfigTypes";
import type { CommandPanelProps } from "./types";

// ---------------------------------------------------------------------------
// Prompt rows — chronology of the use case
// ---------------------------------------------------------------------------

type IntentKey = "task" | "when" | "output" | "tools" | "review";
type IntentDraft = Record<IntentKey, string>;

interface IntentRowDef {
  key: IntentKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  placeholder: string;
  /** Multi-line textarea vs single-line input. */
  multiline: boolean;
  /** Sentence label prepended when composing intent ("Task: ..."). */
  composeLabel: string;
}

const INTENT_ROWS: IntentRowDef[] = [
  {
    key: "task",
    label: "Task",
    icon: ListTodo,
    placeholder: "Summarize incoming support emails and extract customer intent.",
    multiline: true,
    composeLabel: "Task",
  },
  {
    key: "when",
    label: "When",
    icon: Calendar,
    placeholder: "Every weekday at 9am — or when a new Slack message mentions @support.",
    multiline: false,
    composeLabel: "When",
  },
  {
    key: "output",
    label: "Output",
    icon: MessageSquare,
    placeholder: "A ranked list of issues posted to the engineering Slack channel.",
    multiline: true,
    composeLabel: "Output",
  },
  {
    key: "tools",
    label: "Tools",
    icon: Plug,
    placeholder: "Gmail, Slack, Notion.",
    multiline: false,
    composeLabel: "Tools",
  },
  {
    key: "review",
    label: "Review",
    icon: UserCheck,
    placeholder: "Only items marked high priority or containing customer PII.",
    multiline: false,
    composeLabel: "Human review",
  },
];

const EMPTY_DRAFT: IntentDraft = { task: "", when: "", output: "", tools: "", review: "" };

/** Join non-empty rows into a single labelled intent string. */
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
// Structured setup v2 — lives in rows that visually match the prompt rows
// ---------------------------------------------------------------------------

const FREQUENCY_OPTIONS: Array<{ id: Frequency | "none"; label: string }> = [
  { id: "none",    label: "None" },
  { id: "daily",   label: "Daily" },
  { id: "weekly",  label: "Weekly" },
  { id: "monthly", label: "Monthly" },
];

// ---------------------------------------------------------------------------
// Shared row shell
// ---------------------------------------------------------------------------

interface RowProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
  /** Pulls the label's baseline down so multiline inputs align cleanly. */
  alignTop?: boolean;
}
function Row({ icon: Icon, label, children, alignTop }: RowProps) {
  return (
    <div className={`flex gap-3 py-3 border-b border-border/15 last:border-0 ${alignTop ? "items-start" : "items-center"}`}>
      <div className={`shrink-0 w-28 flex items-center gap-1.5 typo-label uppercase tracking-[0.18em] text-foreground/55 ${alignTop ? "pt-2" : ""}`}>
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Composer component
// ---------------------------------------------------------------------------

export function CommandPanelComposer({
  intentText, onIntentChange, onLaunch, launchDisabled, onKeyDown, onQuickConfigChange,
}: CommandPanelProps) {
  // Seed row 1 from any inbound `intentText` (e.g. workflow-import prefilled
  // the intent before this variant mounted). Subsequent edits are local.
  const [draft, setDraft] = useState<IntentDraft>(() =>
    intentText ? { ...EMPTY_DRAFT, task: intentText } : EMPTY_DRAFT,
  );
  const [frequency, setFrequency] = useState<Frequency | null>(null);
  const [time, setTime] = useState("09:00");
  const [selectedConnectors, setSelectedConnectors] = useState<string[]>([]);

  // Propagate composed intent upward on every change. Skip the first run so
  // we don't overwrite an inbound `intentText` (e.g. from a workflow import)
  // with a labelled version before the user has interacted.
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    onIntentChange(composeIntent(draft));
  }, [draft, onIntentChange]);

  // Propagate structured setup upward.
  useEffect(() => {
    if (!onQuickConfigChange) return;
    const next: QuickConfigState = {
      frequency,
      days: ["mon"],
      monthDay: 1,
      time,
      selectedConnectors,
      connectorTables: {},
      selectedEvents: [],
    };
    onQuickConfigChange(next);
  }, [frequency, time, selectedConnectors, onQuickConfigChange]);

  const healthyConnectors = useHealthyConnectors();
  const connectorOptions = useMemo(
    () => healthyConnectors.map((c) => ({ name: c.name, label: c.meta.label })),
    [healthyConnectors],
  );

  const setRow = (key: IntentKey, value: string) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const toggleConnector = (name: string) => {
    setSelectedConnectors((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  };

  return (
    <div className="w-full max-w-5xl relative">
      {/* Ambient primary halo behind the composer */}
      <div
        aria-hidden
        className="absolute -inset-6 rounded-modal pointer-events-none opacity-60"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 40%, rgba(96,165,250,0.18), transparent 70%)",
        }}
      />

      <div className="relative flex flex-col rounded-modal border border-card-border bg-gradient-to-br from-card-bg via-card-bg/85 to-primary/[0.06] backdrop-blur-lg shadow-elevation-3 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-1.5 px-5 md:px-6 pt-5 md:pt-6 pb-2 typo-label font-bold uppercase tracking-[0.22em] text-foreground/55">
          <Sparkles className="w-3.5 h-3.5 text-primary/80" />
          Design your agent
        </div>

        {/* Intent rows — chronological narrative */}
        <div className="px-5 md:px-6 pb-2">
          {INTENT_ROWS.map((row) => (
            <Row key={row.key} icon={row.icon} label={row.label} alignTop={row.multiline}>
              {row.multiline ? (
                <textarea
                  value={draft[row.key]}
                  onChange={(e) => setRow(row.key, e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={row.placeholder}
                  rows={2}
                  data-testid={`composer-row-${row.key}`}
                  className="w-full bg-transparent typo-body-lg text-foreground placeholder:text-foreground/30 placeholder:italic focus:outline-none resize-none leading-relaxed"
                />
              ) : (
                <input
                  type="text"
                  value={draft[row.key]}
                  onChange={(e) => setRow(row.key, e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={row.placeholder}
                  data-testid={`composer-row-${row.key}`}
                  className="w-full bg-transparent typo-body-lg text-foreground placeholder:text-foreground/30 placeholder:italic focus:outline-none leading-relaxed"
                />
              )}
            </Row>
          ))}
        </div>

        {/* Divider between narrative and structured setup */}
        {onQuickConfigChange && (
          <div className="border-t border-border/25 bg-foreground/[0.02] px-5 md:px-6 pt-2 pb-2">
            <div className="typo-label uppercase tracking-[0.22em] text-foreground/40 py-2">
              Structured defaults · optional
            </div>

            {/* Schedule row */}
            <Row icon={Clock} label="Schedule">
              <div className="flex items-center gap-2 flex-wrap">
                {FREQUENCY_OPTIONS.map((opt) => {
                  const active = (opt.id === "none" && frequency === null) || opt.id === frequency;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setFrequency(opt.id === "none" ? null : opt.id)}
                      data-testid={`composer-frequency-${opt.id}`}
                      className={`px-3 py-1 rounded-full typo-caption transition ${
                        active
                          ? "bg-primary/25 text-foreground border border-primary/40"
                          : "bg-foreground/5 text-foreground/60 border border-border/30 hover:border-border/60 hover:text-foreground"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
                {frequency !== null && (
                  <div className="flex items-center gap-1.5 ml-1">
                    <span className="typo-caption text-foreground/40">at</span>
                    <input
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      className="bg-foreground/5 border border-border/30 rounded-interactive px-2 py-1 typo-caption text-foreground focus:outline-none focus:border-primary/40"
                    />
                  </div>
                )}
              </div>
            </Row>

            {/* Apps row */}
            <Row icon={Zap} label="Apps" alignTop>
              {connectorOptions.length === 0 ? (
                <p className="typo-caption text-foreground/40 italic py-1">
                  No connected apps yet — describe them in "Tools" above, or add credentials in the vault.
                </p>
              ) : (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {connectorOptions.map((c) => {
                    const active = selectedConnectors.includes(c.name);
                    return (
                      <button
                        key={c.name}
                        type="button"
                        onClick={() => toggleConnector(c.name)}
                        data-testid={`composer-connector-${c.name}`}
                        className={`px-2.5 py-1 rounded-full typo-caption transition ${
                          active
                            ? "bg-primary/25 text-foreground border border-primary/40"
                            : "bg-foreground/5 text-foreground/60 border border-border/30 hover:border-border/60 hover:text-foreground"
                        }`}
                      >
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </Row>
          </div>
        )}

        {/* Footer — keyboard hint + send */}
        <div className="border-t border-border/25 bg-foreground/[0.03] px-5 md:px-6 py-3 flex items-center justify-between gap-3">
          <span className="typo-caption text-foreground/40">
            Enter to summon · Shift + Enter for a new line
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
      </div>
    </div>
  );
}
