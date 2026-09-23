/** FrameCapabilities - how each capability of the draft uses one frame's
 *  dimension: its own value, the agent-wide one, or not at all. Rows carry an
 *  edge number like the frames do, so the list reads as the frame's own strip. */
import type { GlyphDimension, GlyphRow } from "@/features/shared/glyph";
import { DIM_META } from "@/features/shared/glyph";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { COPY } from "./copy";

function rowDetail(dim: GlyphDimension, r: GlyphRow): string {
  switch (dim) {
    case "trigger": return r.triggers.map((t) => t.description || t.trigger_type).join(", ");
    case "task": return r.summary || r.description || "";
    case "connector": return r.connectors.map((c) => c.label || c.name).join(", ");
    case "message": return r.messageSummary ?? "";
    case "review": return r.reviewSummary ?? "";
    case "memory": return r.memorySummary ?? "";
    case "event": return r.events.map((e) => e.description || e.event_type).join(", ");
    case "error": return r.errorSummary ?? "";
  }
}

const PRESENCE: Record<string, string> = { linked: COPY.frame.ownValue, shared: COPY.frame.inherits, none: COPY.frame.none };

export function FrameCapabilities({ dim, rows }: { dim: GlyphDimension; rows: GlyphRow[] }) {
  const color = DIM_META[dim].color;
  return (
    <div className="flex flex-col gap-2">
      <span className="typo-caption font-semibold uppercase tracking-[0.1em] text-foreground">{COPY.frame.perCapability}</span>
      <ol className="m-0 p-0 list-none flex flex-col">
        {rows.map((r, i) => {
          const presence = r.presence[dim];
          const detail = presence === "none" ? "" : rowDetail(dim, r);
          return (
            <li key={r.id} className="flex items-start gap-3 py-2 border-b border-card-border last:border-b-0">
              <span className="font-mono typo-caption text-foreground pt-0.5 shrink-0">{String(i + 1).padStart(2, "0")}</span>
              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                <span className="typo-body font-semibold text-foreground">{r.title}</span>
                {detail && <span className="typo-body text-foreground">{detail}</span>}
              </div>
              <span
                className="typo-caption px-2 py-0.5 rounded-full border whitespace-nowrap"
                style={presence === "linked" ? { color, borderColor: colorWithAlpha(color, 0.4) } : undefined}
              >
                {PRESENCE[presence] ?? presence}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
