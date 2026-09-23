/** sheetModel - pure derivations for the Contact Sheet (Personas) layout.
 *
 *  Each of the eight dimension frames is a small state machine
 *  (blank -> filling / pending -> lit | unset | error) plus a value the frame
 *  "develops" into a picture. Everything here is derived from REAL props:
 *  the pre-launch quick config, the build's cell states, the pending
 *  questions, the user's unsent answers and the draft's glyph rows. */
import type { GlyphDimension, GlyphRow } from "@/features/shared/glyph";
import { parseChannels, prettyTriggerType, triggerDetail } from "@/features/shared/glyph";
import type { QuickConfigState } from "@/features/agents/shared/quickConfig/quickConfigTypes";
import type { CellBuildStatus } from "@/lib/types/buildTypes";
import type { Translations } from "@/i18n/useTranslation";
import { DIM_TO_CELL_KEY } from "../../glyphLayoutHelpers";
import { COPY } from "./copy";

/** Clockwise from the top-left corner, the prompt in the middle. */
export const SHEET_ORDER: readonly GlyphDimension[] = [
  "trigger", "task", "connector", "message", "review", "memory", "event", "error",
];
export const GRID_AREA: Record<GlyphDimension, string> = {
  trigger: "1 / 1", task: "1 / 2", connector: "1 / 3", message: "2 / 3",
  review: "3 / 3", memory: "3 / 2", event: "3 / 1", error: "2 / 1",
};

export const WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const WEEK_LETTER = ["M", "T", "W", "T", "F", "S", "S"] as const;

export type FrameState = "blank" | "filling" | "pending" | "lit" | "unset" | "error";

export interface FrameValue {
  words: string;
  days?: string[];
  time?: string | null;
  triggerType?: string;
  apps?: string[];
  channels?: string[];
  count?: number;
  on?: boolean;
  from?: string;
}

export interface Frame {
  dim: GlyphDimension;
  state: FrameState;
  value: FrameValue | null;
  by: "you" | "ai" | null;
}

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trim()}…` : s);

export function dayWords(days: string[]): string {
  const set = WEEK.filter((d) => days.includes(d));
  if (set.length === 7) return COPY.capEveryDay;
  if (set.length === 5 && !set.includes("sat") && !set.includes("sun")) return COPY.capWeekdays;
  return set.map((d) => d[0]!.toUpperCase() + d.slice(1, 3)).join(" ");
}

/** "m h * * dow" -> week strip + time. Anything richer returns null so the
 *  frame falls back to the humanized text instead of misdrawing the week. */
export function parseCron(cron: string): { days: string[]; time: string | null } | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts as [string, string, string, string, string];
  if (dom !== "*" || mon !== "*") return null;
  const time = /^\d+$/.test(min) && /^\d+$/.test(hour) ? `${hour.padStart(2, "0")}:${min.padStart(2, "0")}` : null;
  const idx = (n: number) => WEEK[(n + 6) % 7]!; // cron 0 = Sunday
  if (dow === "*") return { days: [...WEEK], time };
  const days = new Set<string>();
  for (const seg of dow.split(",")) {
    const range = seg.match(/^(\d)-(\d)$/);
    if (range) { for (let i = Number(range[1]); i <= Number(range[2]); i++) days.add(idx(i)); continue; }
    if (/^\d$/.test(seg)) days.add(idx(Number(seg))); else return null;
  }
  return { days: [...days], time };
}

type ComposeToggles = { memory: boolean; review: boolean };

export function fromQuickConfig(dim: GlyphDimension, qc: QuickConfigState | null, toggles: ComposeToggles): FrameValue | null {
  if (dim === "memory") return toggles.memory ? { words: COPY.capMemoryOn, on: true } : null;
  if (dim === "review") return toggles.review ? { words: COPY.capReviewOn, on: true } : null;
  if (!qc) return null;
  if (dim === "trigger" && qc.frequency) {
    const days = qc.frequency === "daily" ? [...WEEK] : qc.frequency === "weekly" ? qc.days : [];
    const words = qc.frequency === "monthly" ? COPY.capMonthly(qc.monthDay, qc.time) : COPY.capAt(dayWords(days), qc.time);
    return { words, days, time: qc.time, triggerType: "schedule" };
  }
  if (dim === "connector" && qc.selectedConnectors.length > 0) {
    return { words: qc.selectedConnectors.join(", "), apps: qc.selectedConnectors };
  }
  if (dim === "message") {
    const ext = qc.notificationChannels.filter((c) => c.type !== "built-in").map((c) => c.type);
    return ext.length ? { words: ext.join(", "), channels: ["built-in", ...ext] } : null;
  }
  if (dim === "event" && qc.selectedEvents.length > 0) {
    const e = qc.selectedEvents[0]!;
    return { words: short(e.description, 40), on: true, from: e.personaName };
  }
  return null;
}

const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const uses = (rows: GlyphRow[], dim: GlyphDimension) => rows.filter((r) => r.enabled && r.presence[dim] !== "none");

export function fromRows(dim: GlyphDimension, rows: GlyphRow[], t: Translations): FrameValue | null {
  if (rows.length === 0) return null;
  if (dim === "task") {
    const n = rows.filter((r) => r.enabled).length || rows.length;
    return { words: n === 1 ? COPY.capOneCapability : COPY.capCapabilities(n), count: n };
  }
  if (dim === "trigger") {
    const all = rows.flatMap((r) => r.triggers);
    if (all.length === 0) return null;
    const sched = all.find((tr) => tr.trigger_type === "schedule" && typeof tr.config?.cron === "string");
    const parsed = sched ? parseCron(String(sched.config!.cron)) : null;
    if (sched && parsed) return { words: triggerDetail(t, sched) || dayWords(parsed.days), ...parsed, triggerType: "schedule" };
    const first = all[0]!;
    return { words: triggerDetail(t, first) || prettyTriggerType(t, first.trigger_type), triggerType: first.trigger_type };
  }
  if (dim === "connector") {
    const apps = uniq(rows.flatMap((r) => r.connectors.map((c) => c.name)).filter(Boolean));
    return apps.length ? { words: apps.join(", "), apps } : null;
  }
  if (dim === "message") {
    const channels = uniq(rows.flatMap((r) => parseChannels(r.messageSummary).map((c) => c.type.toLowerCase())));
    return channels.length ? { words: channels.join(", "), channels } : null;
  }
  if (dim === "event") {
    const ev = rows.flatMap((r) => r.events);
    return ev.length ? { words: short(ev[0]!.description || ev[0]!.event_type, 40), on: true, from: ev[0]!.event_type } : null;
  }
  const used = uses(rows, dim);
  if (used.length === 0) return null;
  const summary = used.map((r) => (dim === "review" ? r.reviewSummary : dim === "memory" ? r.memorySummary : r.errorSummary)).find(Boolean);
  return { words: short(summary ?? COPY.capOn, 40), on: true };
}

/** An unsent answer, drawn as well as the text allows. */
export function fromAnswer(dim: GlyphDimension, answer: string): FrameValue {
  const words = short(answer, 40);
  if (dim === "trigger") {
    const m = answer.match(/(\d{1,2}):(\d{2})/);
    const time = m ? `${m[1]!.padStart(2, "0")}:${m[2]}` : null;
    const days = /weekday/i.test(answer) ? WEEK.slice(0, 5) : /every ?day|daily/i.test(answer) ? [...WEEK] : null;
    return days || time ? { words, days: days ?? [...WEEK], time, triggerType: "schedule" } : { words };
  }
  if (dim === "connector" && /^[a-z0-9_-]+$/i.test(answer.split(":")[0]!.trim())) {
    return { words, apps: [answer.split(":")[0]!.trim()] };
  }
  if (dim === "message") {
    const m = answer.match(/slack|telegram|email|discord|teams/i);
    return { words, channels: m ? ["built-in", m[0].toLowerCase()] : ["built-in"] };
  }
  if (dim === "event") return { words, on: !/^no\b/i.test(answer), from: answer };
  return { words, on: !/^(no|never|off)\b/i.test(answer) };
}

interface DeriveArgs {
  compose: boolean;
  postDraft: boolean;
  failed: boolean;
  composeValues: Partial<Record<GlyphDimension, FrameValue>>;
  cellStates: Record<string, CellBuildStatus>;
  pendingDims: Set<GlyphDimension>;
  answered: Partial<Record<GlyphDimension, string>>;
  rows: GlyphRow[];
  t: Translations;
}

export function deriveFrames(a: DeriveArgs): Record<GlyphDimension, Frame> {
  const out = {} as Record<GlyphDimension, Frame>;
  for (const dim of SHEET_ORDER) {
    const mine = a.composeValues[dim] ?? null;
    const ans = a.answered[dim];
    const rowVal = fromRows(dim, a.rows, a.t);
    let f: Frame;
    if (a.compose) f = { dim, state: mine ? "lit" : "blank", value: mine, by: mine ? "you" : null };
    else if (a.postDraft) {
      const v = rowVal ?? mine;
      f = { dim, state: v ? "lit" : "unset", value: v, by: ans || mine ? "you" : "ai" };
    } else if (ans) f = { dim, state: "lit", value: fromAnswer(dim, ans), by: "you" };
    else if (a.pendingDims.has(dim)) f = { dim, state: "pending", value: null, by: null };
    else {
      const cell = a.cellStates[DIM_TO_CELL_KEY[dim]];
      if (cell === "error") f = { dim, state: "error", value: null, by: null };
      else if (cell === "resolved" || cell === "updated" || cell === "highlighted" || rowVal) {
        f = { dim, state: "lit", value: rowVal ?? mine ?? { words: COPY.capDecidedByBuild }, by: mine ? "you" : "ai" };
      } else if (mine) f = { dim, state: "lit", value: mine, by: "you" };
      else if ((cell === "filling" || cell === "pending") && !a.failed) f = { dim, state: "filling", value: null, by: null };
      else f = { dim, state: "blank", value: null, by: null };
    }
    out[dim] = f;
  }
  return out;
}
