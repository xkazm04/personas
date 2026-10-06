/** What the dial draws, as data. Every sector has an INK STATE (the line
 *  language Studio's drafting sheet uses: a dashed outline still to draw, a
 *  hatched drawing in work, a solid inked part with a tick), and the rim
 *  collects one METADATA TICK per thing the build has learned (a capability, a
 *  connector, a trigger, a channel, an event, an answer, a test result). Both
 *  come out of live data only: nothing is staged, and a part with nothing
 *  behind it is never drawn. No React. */
import type { GlyphDimension } from "@/features/shared/glyph";
import { GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import type { ToolTestResult } from "@/lib/types/buildTypes";
import type { FrameState } from "../cinema/sheetModel";
import type { FrameValue } from "../cinema/useFrameValues";
import { COPY } from "./copy";

export type Ink = "pending" | "drafting" | "asking" | "done" | "error";

export function inkOf(state: FrameState): Ink {
  switch (state) {
    case "lit": return "done";
    case "filling": return "drafting";
    case "pending": return "asking";
    case "error": return "error";
    default: return "pending";
  }
}

export type MarkKind = keyof typeof COPY.kind;

/** One drawing step: a sector re-inked, or a tick added to the rim. */
export interface DialMark {
  id: string;
  dim: GlyphDimension;
  kind: MarkKind;
  text: string;
  /** Sector marks: the ink the sector takes when this step is drawn. */
  ink?: Ink;
  /** Test ticks: how the screening went. */
  tone?: "good" | "bad";
}

const KIND_OF: Partial<Record<GlyphDimension, MarkKind>> = {
  task: "capability", connector: "connector", trigger: "trigger", message: "channel", event: "event",
};

/** The sub-parts a dimension carries: what its rim ticks and its exploded fan count. */
export function partsOf(dim: GlyphDimension, v: FrameValue | null): string[] {
  if (!v) return [];
  const pick = dim === "task" ? v.caps : dim === "message" ? v.channels : dim === "event" ? v.events : null;
  const list = pick?.length ? pick : v.lines.length ? v.lines : [v.caption];
  return Array.from(new Set(list.map((s) => s.trim()).filter(Boolean)));
}

/** The rim's ticks, from confirmed values, answers given on the sheet and the screening. */
export function rimTicks(
  values: Record<GlyphDimension, FrameValue | null>,
  answered: Partial<Record<GlyphDimension, string>>,
  tests: readonly ToolTestResult[],
): DialMark[] {
  const out: DialMark[] = [];
  for (const dim of GLYPH_DIMENSIONS) {
    // The composer's own words are the brief, not a capability: no tick per keystroke.
    const v = dim === "task" && values.task?.by === "you" ? null : values[dim];
    // An answer is its own tick; a value that IS the answer is not counted twice.
    if (v && v.by !== "you") {
      const kind = KIND_OF[dim] ?? "note";
      for (const text of partsOf(dim, v)) out.push({ id: `${dim}:${kind}:${text}`, dim, kind, text });
    } else if (v && !answered[dim]) {
      for (const text of partsOf(dim, v)) out.push({ id: `${dim}:set:${text}`, dim, kind: KIND_OF[dim] ?? "note", text });
    }
    const a = answered[dim];
    if (a) out.push({ id: `${dim}:answer`, dim, kind: "answer", text: a });
  }
  for (const r of tests) {
    if (r.status === "skipped") continue;
    out.push({ id: `test:${r.tool_name}:${r.status}`, dim: "task", kind: "test", text: r.tool_name, tone: r.status === "passed" ? "good" : "bad" });
  }
  return out;
}

/** The append-only drawing log of one build session. */
export interface MarkLog {
  key: string;
  marks: DialMark[];
  lastInk: Partial<Record<GlyphDimension, Ink>>;
  rev: number;
}

export const emptyLog = (key: string): MarkLog => ({ key, marks: [], lastInk: {}, rev: 0 });

/** Grow the log with what is new: a sector whose ink changed gets a new step,
 *  a tick not seen before is appended, a tick that went away is dropped. Steps
 *  already drawn keep their place, so the drawing never reorders. Returns the
 *  SAME log when nothing changed (so it can run during render). */
export function growLog(
  log: MarkLog,
  inks: Record<GlyphDimension, Ink>,
  ticks: readonly DialMark[],
  sectorText: (dim: GlyphDimension, ink: Ink) => string,
): MarkLog {
  let marks = log.marks;
  let lastInk = log.lastInk;
  let rev = log.rev;
  let changed = false;
  for (const dim of GLYPH_DIMENSIONS) {
    const ink = inks[dim];
    if (ink === (lastInk[dim] ?? "pending")) continue;
    if (!changed) { marks = [...marks]; lastInk = { ...lastInk }; changed = true; }
    marks.push({ id: `sector:${dim}:${rev}`, dim, kind: "sector", ink, text: sectorText(dim, ink) });
    lastInk[dim] = ink;
    rev += 1;
  }
  const live = new Set(ticks.map((t) => t.id));
  const have = new Set(marks.map((m) => m.id));
  const fresh = ticks.filter((t) => !have.has(t.id));
  const stale = marks.some((m) => m.kind !== "sector" && !live.has(m.id));
  if (!changed && fresh.length === 0 && !stale) return log;
  marks = [...marks, ...fresh].filter((m) => m.kind === "sector" || live.has(m.id));
  return { key: log.key, marks, lastInk, rev };
}

/** What is drawn after `count` steps: each sector's ink, the rim's ticks per dimension. */
export function drawnState(marks: readonly DialMark[], count: number) {
  const drawn = marks.slice(0, count);
  const ink = {} as Record<GlyphDimension, Ink>;
  const ticks = {} as Record<GlyphDimension, DialMark[]>;
  for (const dim of GLYPH_DIMENSIONS) { ink[dim] = "pending"; ticks[dim] = []; }
  for (const m of drawn) {
    if (m.kind === "sector" && m.ink) ink[m.dim] = m.ink;
    else if (m.kind !== "sector") ticks[m.dim].push(m);
  }
  return { ink, ticks, latest: drawn[drawn.length - 1] ?? null, rimCount: drawn.filter((m) => m.kind !== "sector").length };
}
