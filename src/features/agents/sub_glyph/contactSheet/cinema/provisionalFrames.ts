/** provisionalFrames — the build's first-turn PREVIEW, projected onto the
 *  eight frames. Pure; no React.
 *
 *  While the first LLM turn streams (50-155 s), the backend releases each
 *  finished capability enumeration / resolution as a provisional event
 *  (matrixBuildSlice `provisional`). A frame one of them touches DEVELOPS
 *  (FrameState "filling") and may show the picture it is developing into, but
 *  it is never lit and never counts as populated: only the authoritative pass
 *  does that, and it replaces the preview whole when it lands. */
import type { GlyphDimension } from "@/features/shared/glyph";
import { GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import { CELL_KEY_TO_DIM } from "@/features/agents/sub_glyph/glyphLayoutHelpers";
import { getConnectorMeta } from "@/lib/connectors/connectorMeta";
import type { Translations } from "@/i18n/en";
import type { ProvisionalBuildState } from "@/stores/slices/agents/matrixBuildSlice";
import type { FrameValue } from "./useFrameValues";
import { triggerFrameValue } from "./useFrameValues";
import { COPY } from "./copy";

/** The frame a previewed field develops. The backend decides the cell (the
 *  same mapping its authoritative pass lights later) and sends it on the
 *  event; this only turns that cell key into a frame. */
export function provisionalCellDim(cellKey: string | undefined): GlyphDimension | null {
  return cellKey ? CELL_KEY_TO_DIM[cellKey] ?? null : null;
}

/** Which frames the preview touches: the task frame once capabilities are
 *  enumerated, and each resolved field's own frame. */
export function provisionalDims(p: ProvisionalBuildState): Set<GlyphDimension> {
  const out = new Set<GlyphDimension>();
  for (const id of p.order) {
    const cap = p.capabilities[id];
    if (!cap) continue;
    out.add("task");
    for (const cellKey of Object.values(cap.cells)) {
      const dim = provisionalCellDim(cellKey);
      if (dim) out.add(dim);
    }
  }
  return out;
}

const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean)));
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** The picture a developing frame shows. `null` where the preview has nothing
 *  drawable for a dimension; the frame then just develops with its caption. */
export function provisionalFrameValues(p: ProvisionalBuildState, t: Translations): Record<GlyphDimension, FrameValue | null> {
  const out = {} as Record<GlyphDimension, FrameValue | null>;
  for (const dim of GLYPH_DIMENSIONS) out[dim] = null;
  const caps = p.order.map((id) => p.capabilities[id]).filter((c): c is NonNullable<typeof c> => !!c);
  if (!caps.length) return out;

  const titles = caps.map((c) => c.title);
  out.task = { caps: titles, caption: `${titles.length} ${COPY.capabilities.toLowerCase()}`, lines: titles, by: "ai" };

  const trig = caps
    .map((c) => c.fields.suggested_trigger)
    .find((v): v is { trigger_type: string } => !!v && typeof v === "object" && typeof (v as { trigger_type?: unknown }).trigger_type === "string");
  if (trig) out.trigger = triggerFrameValue(trig, [], t);

  const apps = uniq(caps.flatMap((c) => strings(c.fields.connectors)));
  if (apps.length) {
    const labels = apps.map((a) => getConnectorMeta(a).label);
    out.connector = { apps, caption: labels.slice(0, 2).join(", ") + (labels.length > 2 ? ` +${labels.length - 2}` : ""), lines: labels, by: "ai" };
  }

  const channels = uniq(caps.flatMap((c) => {
    const v = c.fields.notification_channels;
    return Array.isArray(v) ? v.map((e) => (e && typeof e === "object" ? String((e as { channel?: unknown }).channel ?? "") : "")) : [];
  }));
  if (channels.length) out.message = { channels, caption: channels.join(", "), lines: [], by: "ai" };

  return out;
}
