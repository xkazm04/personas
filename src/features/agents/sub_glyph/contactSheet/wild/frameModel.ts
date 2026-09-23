/** frameModel: what each of the eight frames shows, derived from real props.
 *
 *  Before launch a frame reflects the user's own pre-launch picks (the
 *  QuickConfigState the compose pickers emit, plus the memory / review toggles).
 *  After launch it reflects only what the build has produced: cell statuses
 *  from the engine, then the capability rows' real triggers, connectors,
 *  channels and summaries. A frame never shows a picture the build has not
 *  earned. */
import { GLYPH_DIMENSIONS, parseChannels, triggerDetail, prettyTriggerType } from "@/features/shared/glyph";
import type { GlyphDimension, GlyphRow } from "@/features/shared/glyph";
import type { BuildQuestion, CellBuildStatus } from "@/lib/types/buildTypes";
import type { QuickConfigState } from "@/features/agents/shared/quickConfig/quickConfigTypes";
import { describeTriggerConfig } from "@/features/agents/shared/quickConfig/quickConfigTypes";
import type { Translations } from "@/i18n/en";
import { CELL_KEY_TO_DIM, derivePetalState } from "../../glyphLayoutHelpers";
import { COPY } from "./wildCopy";

export type FrameState = "blank" | "latent" | "pending" | "developed" | "unused" | "fogged";

export type Picture =
  | { kind: "week"; on: boolean[]; time: string | null }
  | { kind: "trigger"; type: string }
  | { kind: "reel"; n: number }
  | { kind: "apps"; names: string[] }
  | { kind: "channels"; types: string[] }
  | { kind: "relay"; from: string }
  | { kind: "glyph"; dim: GlyphDimension };

export interface FrameModel {
  dim: GlyphDimension;
  state: FrameState;
  by: "you" | "ai" | null;
  caption: string;
  picture: Picture | null;
}

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** Cron day-of-week field → Monday-first 7-day mask. Unknown shapes → null. */
function cronWeek(cron: string): { on: boolean[]; time: string | null } | null {
  const p = cron.trim().split(/\s+/);
  if (p.length !== 5) return null;
  const [min, hour, , , dow] = p as [string, string, string, string, string];
  const on = new Array<boolean>(7).fill(false);
  const setDay = (n: number) => { on[(n + 6) % 7] = true; }; // 0/7 = Sunday
  if (dow === "*") on.fill(true);
  else {
    for (const part of dow.split(",")) {
      const [a, b] = part.split("-").map((x) => parseInt(x, 10));
      if (a === undefined || Number.isNaN(a)) return null;
      if (b === undefined || Number.isNaN(b)) setDay(a % 7);
      else for (let d = a; d <= b; d++) setDay(d % 7);
    }
  }
  const time = /^\d+$/.test(min) && /^\d+$/.test(hour) ? `${hour.padStart(2, "0")}:${min.padStart(2, "0")}` : null;
  return { on, time };
}

function uniq(xs: string[]): string[] {
  const seen = new Set<string>();
  return xs.filter((x) => { const k = x.toLowerCase(); if (!x || seen.has(k)) return false; seen.add(k); return true; });
}

export interface ComposeFacts { quick: QuickConfigState | null; memory: boolean; review: boolean; intent: string }

function composeFrame(dim: GlyphDimension, f: ComposeFacts): FrameModel {
  const q = f.quick;
  const set = (caption: string, picture: Picture): FrameModel => ({ dim, state: "developed", by: "you", caption, picture });
  const blank: FrameModel = { dim, state: "blank", by: null, caption: COPY.frame.blank, picture: null };
  if (dim === "task" && f.intent.trim()) return set(f.intent.trim().split(/\s+/).slice(0, 6).join(" "), { kind: "reel", n: 1 });
  if (dim === "trigger" && q?.frequency) {
    const caption = describeTriggerConfig(q)[0] ?? "";
    if (q.frequency === "monthly") return set(caption, { kind: "trigger", type: "schedule" });
    const on = q.frequency === "weekly" ? DAY_KEYS.map((d) => q.days.includes(d)) : new Array<boolean>(7).fill(true);
    return set(caption, { kind: "week", on, time: q.time });
  }
  if (dim === "connector" && q && q.selectedConnectors.length > 0) return set(q.selectedConnectors.join(", "), { kind: "apps", names: q.selectedConnectors });
  if (dim === "message" && q) {
    const ext = q.notificationChannels.filter((c) => c.type !== "built-in").map((c) => c.type);
    if (ext.length) return set(ext.join(", "), { kind: "channels", types: ext });
  }
  if (dim === "event" && q && q.selectedEvents.length > 0) {
    const e = q.selectedEvents[0]!;
    return set(e.description, { kind: "relay", from: e.personaName });
  }
  if (dim === "memory" && f.memory) return set(COPY.loupe.on, { kind: "glyph", dim });
  if (dim === "review" && f.review) return set(COPY.loupe.on, { kind: "glyph", dim });
  return blank;
}

function buildPicture(t: Translations, dim: GlyphDimension, rows: GlyphRow[]): { caption: string; picture: Picture } | null {
  const used = rows.filter((r) => r.presence[dim] !== "none");
  if (used.length === 0) return null;
  switch (dim) {
    case "trigger": {
      const trs = used.flatMap((r) => r.triggers);
      const sched = trs.find((tr) => tr.trigger_type === "schedule" && typeof tr.config?.cron === "string");
      const wk = sched ? cronWeek(String(sched.config?.cron)) : null;
      const first = sched ?? trs[0];
      if (!first) return { caption: COPY.frame.manual, picture: { kind: "trigger", type: "manual" } };
      const caption = triggerDetail(t, first) || prettyTriggerType(t, first.trigger_type);
      return { caption, picture: wk ? { kind: "week", ...wk } : { kind: "trigger", type: first.trigger_type } };
    }
    case "task": return { caption: used.length === 1 ? used[0]!.title : COPY.frame.capabilities(used.length), picture: { kind: "reel", n: used.length } };
    case "connector": {
      const names = uniq(used.flatMap((r) => r.connectors.map((c) => c.name)));
      return { caption: names.join(", "), picture: names.length ? { kind: "apps", names } : { kind: "glyph", dim } };
    }
    case "message": {
      const types = uniq(used.flatMap((r) => parseChannels(r.messageSummary).map((c) => c.type)));
      return { caption: used[0]!.messageSummary ?? types.join(", "), picture: types.length ? { kind: "channels", types } : { kind: "glyph", dim } };
    }
    case "event": {
      const ev = used.flatMap((r) => r.events)[0];
      return { caption: ev?.description || ev?.event_type || "", picture: { kind: "glyph", dim } };
    }
    case "review": return { caption: used[0]!.reviewSummary ?? "", picture: { kind: "glyph", dim } };
    case "memory": return { caption: used[0]!.memorySummary ?? "", picture: { kind: "glyph", dim } };
    case "error": return { caption: used[0]!.errorSummary ?? "", picture: { kind: "glyph", dim } };
  }
}

export interface BuildFacts {
  cellStates: Record<string, CellBuildStatus>;
  pending: BuildQuestion[] | null;
  rows: GlyphRow[];
  settled: boolean; // draft ready or later: unused frames read "Not used"
}

export function frameModels(t: Translations, compose: ComposeFacts | null, build: BuildFacts): Record<GlyphDimension, FrameModel> {
  const out = {} as Record<GlyphDimension, FrameModel>;
  const pendingDims = new Set<GlyphDimension>();
  for (const q of build.pending ?? []) { const d = CELL_KEY_TO_DIM[q.cellKey]; if (d) pendingDims.add(d); }
  for (const dim of GLYPH_DIMENSIONS) {
    if (compose) { out[dim] = composeFrame(dim, compose); continue; }
    const petal = derivePetalState(dim, build.cellStates, pendingDims, null);
    const pic = buildPicture(t, dim, build.rows);
    if (petal === "pending") out[dim] = { dim, state: "pending", by: null, caption: COPY.frame.pending, picture: null };
    else if (petal === "error") out[dim] = { dim, state: "fogged", by: null, caption: COPY.frame.fogged, picture: null };
    else if (pic) out[dim] = { dim, state: "developed", by: "ai", caption: pic.caption, picture: pic.picture };
    else if (petal === "resolved") out[dim] = { dim, state: "developed", by: "ai", caption: "", picture: { kind: "glyph", dim } };
    else if (petal === "filling") out[dim] = { dim, state: "latent", by: null, caption: COPY.frame.latent, picture: null };
    else out[dim] = { dim, state: build.settled ? "unused" : "blank", by: null, caption: build.settled ? COPY.frame.unused : COPY.frame.blank, picture: null };
  }
  return out;
}

/** Per-capability lines for one dimension, for the loupe's detail page. */
export function dimLines(t: Translations, dim: GlyphDimension, r: GlyphRow): string[] {
  switch (dim) {
    case "trigger": return r.triggers.map((tr) => triggerDetail(t, tr) || prettyTriggerType(t, tr.trigger_type));
    case "connector": return r.connectors.map((c) => [c.label || c.name, c.purpose].filter(Boolean).join(": "));
    case "task": return [r.summary || r.description || r.title];
    case "event": return r.events.map((e) => e.description || e.event_type);
    case "message": return r.messageSummary ? [r.messageSummary] : [];
    case "review": return r.reviewSummary ? [r.reviewSummary] : [];
    case "memory": return r.memorySummary ? [r.memorySummary] : [];
    case "error": return r.errorSummary ? [r.errorSummary] : [];
  }
}
