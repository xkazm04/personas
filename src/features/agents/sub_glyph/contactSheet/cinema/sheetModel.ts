/** Pure model for the Cinema contact sheet: where each frame sits, which act
 *  the build is in, and the small parsers the frame pictures need. No React. */
import type { GlyphDimension } from "@/features/shared/glyph";
import { GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import type { BuildPhase } from "@/lib/types/buildTypes";
import type { PetalState } from "@/features/shared/glyph/persona-sigil";

/** Frames sit where their sigil petal points. PETAL_ANGLES runs clockwise from
 *  12 o'clock (trigger 0°, task 45°, ... error 315°), so each frame takes the
 *  sheet cell its petal aims at and the living sigil under the sheet reaches
 *  into the frame it describes. [column, row], 1-based CSS grid lines. */
export const FRAME_CELL: Record<GlyphDimension, [number, number]> = {
  trigger: [2, 1],
  task: [3, 1],
  connector: [3, 2],
  message: [3, 3],
  review: [2, 3],
  memory: [1, 3],
  event: [1, 2],
  error: [1, 1],
};

/** 01..08, clockwise from the top, matching the petal order. */
export const frameNumber = (dim: GlyphDimension) =>
  String(GLYPH_DIMENSIONS.indexOf(dim) + 1).padStart(2, "0");

export type SheetAct =
  | "compose" | "casting" | "questions" | "wiring" | "draft"
  | "screening" | "verdict" | "premiere" | "stopped";

export interface ActInputs {
  isCompose: boolean;
  isBuilding: boolean;
  buildPhase: BuildPhase | null;
  pendingCount: number;
  hasDesignResult: boolean;
  buildError: string | null;
  /** Latched per session once the first pass has landed (questions or draft). */
  firstPassLanded: boolean;
}

export function deriveAct(i: ActInputs): SheetAct {
  if (i.isCompose) return "compose";
  if (i.buildPhase === "promoted") return "premiere";
  if (i.buildPhase === "failed" || i.buildPhase === "cancelled") return "stopped";
  if (i.buildPhase === "testing") return "screening";
  if (i.buildPhase === "test_complete") return "verdict";
  if (i.pendingCount > 0) return "questions";
  if (i.isBuilding) return i.firstPassLanded ? "wiring" : "casting";
  if (i.buildError) return "stopped";
  if (i.hasDesignResult) return "draft";
  return "casting";
}

/** The frame's photographic state. */
export type FrameState = "blank" | "filling" | "pending" | "lit" | "error" | "unset";

export function frameStateFromPetal(p: PetalState, settled: boolean): FrameState {
  switch (p) {
    case "resolved": return "lit";
    case "pending": return "pending";
    case "filling": return "filling";
    case "error": return "error";
    default: return settled ? "unset" : "blank";
  }
}

/** Monday-first week strip + HH:MM, read from a 5-field cron. Returns null
 *  when the expression cannot honestly collapse to a weekly picture. */
export interface WeekPicture { days: boolean[]; time: string | null }

const DOW_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function weekFromCron(cron: string): WeekPicture | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts as [string, string, string, string, string];
  if (dom !== "*" || mon !== "*") return null;
  const single = (f: string) => /^\d+$/.test(f);
  const time = single(min) && single(hour)
    ? `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`
    : null;
  const on = new Array<boolean>(7).fill(false);
  const mark = (cronDay: number) => { on[(cronDay + 6) % 7] = true; };
  if (dow === "*") on.fill(true);
  else {
    for (const token of dow.toLowerCase().split(",")) {
      const range = token.split("-");
      const toNum = (s: string) => (DOW_NAMES.includes(s) ? DOW_NAMES.indexOf(s) : parseInt(s, 10) % 7);
      if (range.length === 2) {
        const a = toNum(range[0]!), b = toNum(range[1]!);
        if (Number.isNaN(a) || Number.isNaN(b)) return null;
        for (let d = a; d !== (b + 1) % 7; d = (d + 1) % 7) mark(d);
        mark(b);
      } else {
        const n = toNum(token);
        if (Number.isNaN(n)) return null;
        mark(n);
      }
    }
  }
  return { days: on, time };
}

/** Week picture from the compose-time quick config. */
export function weekFromQuickConfig(frequency: string | null, days: string[], time: string): WeekPicture | null {
  if (!frequency) return null;
  const keys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const on = frequency === "weekly" ? keys.map((k) => days.includes(k)) : new Array<boolean>(7).fill(frequency === "daily");
  return { days: on, time };
}

/** mm:ss timecode, the film slate's clock. */
export function timecode(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** "1 min 12 s" for prose. */
export function spokenSeconds(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}
