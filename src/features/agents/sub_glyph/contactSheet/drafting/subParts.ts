/** What a dimension's own sheet draws as its parts, read from the same frame
 *  value the region on sheet 1 shows: the apps of Apps, the channels of
 *  Messages, the capabilities of the task, the events, the trigger lines, the
 *  review / memory / error summaries. No value, no parts: a sheet never draws
 *  a part it has nothing for. Pure; no React. */
import type { GlyphDimension } from "@/features/shared/glyph";
import { getConnectorMeta } from "@/lib/connectors/connectorMeta";
import type { FrameValue } from "../cinema/useFrameValues";

export interface SubPart {
  id: string;
  title: string;
  detail?: string;
  /** A connector name, drawn with its brand mark. */
  app?: string;
  /** A channel type, drawn with its channel icon. */
  channel?: string;
}

/** At most this many parts are drawn; the rest are counted on the dimension line. */
export const MAX_PARTS = 8;

const uniq = (xs: string[]) => Array.from(new Set(xs.map((x) => x.trim()).filter(Boolean)));

function allParts(dim: GlyphDimension, v: FrameValue): SubPart[] {
  if (dim === "connector" && v.apps?.length) return v.apps.map((a) => ({ id: a, title: getConnectorMeta(a).label, app: a }));
  if (dim === "message" && v.channels?.length) return v.channels.map((c) => ({ id: c, title: c, channel: c }));
  if (dim === "task" && v.caps?.length) return v.caps.map((c, i) => ({ id: `${i}-${c}`, title: c }));
  if (dim === "event" && v.events?.length) return v.events.map((e, i) => ({ id: `${i}-${e}`, title: e }));
  const lines = uniq(v.lines.length ? v.lines : [v.caption]);
  return lines.map((l, i) => ({
    id: `${i}-${l}`,
    title: l,
    detail: dim === "trigger" && i === 0 && v.week?.time ? v.week.time : undefined,
  }));
}

export function subParts(dim: GlyphDimension, value: FrameValue | null): { parts: SubPart[]; more: number } {
  if (!value) return { parts: [], more: 0 };
  const all = allParts(dim, value);
  return { parts: all.slice(0, MAX_PARTS), more: Math.max(0, all.length - MAX_PARTS) };
}
