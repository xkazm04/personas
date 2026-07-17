import { ListTodo, Calendar, MessageSquare, Plug, UserCheck, Send } from "lucide-react";
import type { GlyphDimension } from "@/features/shared/glyph";
import type { Frequency } from "@/features/agents/shared/quickConfig/quickConfigTypes";

// ---------------------------------------------------------------------------
// Prompt rows
// ---------------------------------------------------------------------------

export type IntentKey =
  | "task"
  | "when"
  | "output"
  | "tools"
  | "review"
  | "messaging";
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
  { key: "task",      label: "Task",      icon: ListTodo,      placeholder: "Summarize incoming support emails and extract customer intent.",        multiline: true,  composeLabel: "Task" },
  { key: "when",      label: "When",      icon: Calendar,      placeholder: "Every weekday at 9am — or when a new Slack message mentions @support.", multiline: false, composeLabel: "When" },
  { key: "output",    label: "Output",    icon: MessageSquare, placeholder: "A ranked list of issues posted to the engineering Slack channel.",     multiline: true,  composeLabel: "Output" },
  { key: "tools",     label: "Tools",     icon: Plug,          placeholder: "Gmail, Slack, Notion.",                                                 multiline: false, composeLabel: "Tools" },
  { key: "messaging", label: "Messaging", icon: Send,          placeholder: "Persona inbox by default — pick from vault to also send to Slack/Telegram/Discord/Teams.", multiline: false, composeLabel: "Messaging" },
  { key: "review",    label: "Review",    icon: UserCheck,     placeholder: "Only items marked high priority or containing customer PII.",          multiline: false, composeLabel: "Human review" },
];

export const EMPTY_DRAFT: IntentDraft = {
  task: "",
  when: "",
  output: "",
  tools: "",
  review: "",
  messaging: "",
};

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
// Stage D Phase 3 — recipe → draft pre-fill (mode 1)
// ---------------------------------------------------------------------------

/**
 * Parse a recipe's JSON requirement blob (tool_requirements,
 * credential_requirements, …) into a flat name list. The field is
 * JSON-encoded (per `db::models::recipe::RecipeDefinition`) and is usually
 * a `string[]` like `["http_request", "file_read"]`, but has also shown up
 * as an array of objects (`{name}` / `{service_type}` / `{connector}`), or
 * an object with a `connectors` array. We accept any of those shapes and
 * quietly drop entries that don't match — a malformed tag entry shouldn't
 * block the entire pre-fill.
 *
 * `dedupe: true` case-insensitively drops repeats (used by the connector
 * picker, which may merge two requirement fields together).
 */
export function parseRecipeNameList(
  raw: string | null | undefined,
  opts: { dedupe?: boolean } = {},
): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.connectors)
        ? parsed.connectors
        : [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const entry of arr) {
      const name =
        typeof entry === "string"
          ? entry
          : entry && typeof entry === "object"
            ? String(entry.name ?? entry.service_type ?? entry.connector ?? "")
            : "";
      if (!name) continue;
      if (opts.dedupe) {
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
      }
      out.push(name);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Parse a recipe's `tool_requirements` JSON string into a comma-separated
 * label suitable for the composer's `tools` row.
 */
export function parseRecipeTools(toolRequirements: string | null | undefined): string {
  return parseRecipeNameList(toolRequirements).join(", ");
}

/**
 * Merge a matched recipe's metadata into an in-flight draft (Stage D Phase 3,
 * mode 1 acceptance).
 *
 * Policy:
 * - `task`: replace with the recipe's description (or name if no description).
 *   The user explicitly opted in by clicking "Use this recipe", so the
 *   recipe's own clearer phrasing wins over the typed fragment that triggered
 *   the suggestion.
 * - `tools`: pre-fill from `tool_requirements` only when the user hasn't
 *   already typed tools. Don't clobber explicit user input on this row —
 *   tools tend to be intentional choices.
 * - `when`, `output`, `review`: leave unchanged. The recipe schema doesn't
 *   express schedules or human-review policy; output_contract is usually a
 *   technical schema rather than a natural-language description.
 *
 * Pure function — no I/O, no side effects. Tests live alongside.
 */
export interface RecipePrefillSource {
  name: string;
  description: string | null;
  tool_requirements: string | null;
}

export function mergeRecipeIntoDraft(
  draft: IntentDraft,
  recipe: RecipePrefillSource,
): IntentDraft {
  const next: IntentDraft = { ...draft };
  next.task = (recipe.description?.trim() || recipe.name).trim();
  if (!draft.tools.trim()) {
    const toolsLabel = parseRecipeTools(recipe.tool_requirements);
    if (toolsLabel) next.tools = toolsLabel;
  }
  return next;
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
