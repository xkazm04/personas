import { ListTodo, Calendar, MessageSquare, Plug, UserCheck } from "lucide-react";
import type { GlyphDimension } from "@/features/shared/glyph";
import type { Frequency } from "@/features/agents/components/matrix/quickConfigTypes";

// ---------------------------------------------------------------------------
// Prompt rows
// ---------------------------------------------------------------------------

export type IntentKey = "task" | "when" | "output" | "tools" | "review";
export type IntentDraft = Record<IntentKey, string>;

export interface IntentRowDef {
  key: IntentKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  placeholder: string;
  multiline: boolean;
  composeLabel: string;
}

export const INTENT_ROWS: IntentRowDef[] = [
  { key: "task",   label: "Task",   icon: ListTodo,     placeholder: "Summarize incoming support emails and extract customer intent.",        multiline: true,  composeLabel: "Task" },
  { key: "when",   label: "When",   icon: Calendar,     placeholder: "Every weekday at 9am — or when a new Slack message mentions @support.", multiline: false, composeLabel: "When" },
  { key: "output", label: "Output", icon: MessageSquare, placeholder: "A ranked list of issues posted to the engineering Slack channel.",     multiline: true,  composeLabel: "Output" },
  { key: "tools",  label: "Tools",  icon: Plug,         placeholder: "Gmail, Slack, Notion.",                                                 multiline: false, composeLabel: "Tools" },
  { key: "review", label: "Review", icon: UserCheck,    placeholder: "Only items marked high priority or containing customer PII.",          multiline: false, composeLabel: "Human review" },
];

export const EMPTY_DRAFT: IntentDraft = { task: "", when: "", output: "", tools: "", review: "" };

export function composeIntent(draft: IntentDraft): string {
  const parts: string[] = [];
  for (const row of INTENT_ROWS) {
    const v = draft[row.key].trim();
    if (!v) continue;
    parts.push(`${row.composeLabel}: ${v}`);
  }
  return parts.join("\n");
}

/**
 * Inverse of composeIntent: split a composed string back into its
 * structured rows. Used when initializing draft from a parent-controlled
 * intentText that may already include `Label: ` prefixes from a prior
 * round-trip — without this, the prefix accumulates ("Task: Task: …")
 * each time the composer remounts.
 */
export function parseIntent(text: string): IntentDraft {
  const draft: IntentDraft = { ...EMPTY_DRAFT };
  if (!text) return draft;
  const labelToKey = new Map<string, IntentKey>(
    INTENT_ROWS.map((r) => [r.composeLabel, r.key]),
  );
  let active: IntentKey = "task";
  for (const rawLine of text.split("\n")) {
    const m = rawLine.match(/^([A-Za-z][A-Za-z ]*?):\s*(.*)$/);
    const label = m?.[1];
    const value = m?.[2] ?? "";
    if (label && labelToKey.has(label)) {
      active = labelToKey.get(label)!;
      draft[active] = draft[active] ? `${draft[active]}\n${value}` : value;
    } else {
      // Continuation line or free-form text — append to the current row.
      draft[active] = draft[active] ? `${draft[active]}\n${rawLine}` : rawLine;
    }
  }
  return draft;
}

// ---------------------------------------------------------------------------
// Q&A — cell key -> glyph dimension (drives icon + tint per question)
// ---------------------------------------------------------------------------

export const CELL_KEY_TO_DIM: Record<string, GlyphDimension> = {
  "use-cases": "task",
  connectors: "connector",
  triggers: "trigger",
  "human-review": "review",
  messages: "message",
  memory: "memory",
  "error-handling": "error",
  events: "event",
};

export const CELL_KEY_LABEL: Record<string, string> = {
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

export function scheduleSummary(freq: Frequency | null, days: string[], monthDay: number, time: string): string | null {
  if (freq === null) return null;
  const t = time || "09:00";
  if (freq === "daily") return `Daily · ${t}`;
  if (freq === "weekly") {
    const labels = days.map((d) => DAY_SHORT[d]).filter(Boolean).join("/");
    return `${labels || "—"} · ${t}`;
  }
  return `Day ${monthDay} · ${t}`;
}
