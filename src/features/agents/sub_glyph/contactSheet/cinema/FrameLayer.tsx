/** FrameLayer — a frame's inner page. Before launch it holds that dimension's
 *  setting (the real composer pickers, opened as modals, or a toggle); once
 *  the draft exists it shows the frame's value and how each capability uses
 *  it (own value, inherits agent-wide, or not used). */
import type { GlyphDimension, GlyphRow } from "@/features/shared/glyph";
import { DIM_META } from "@/features/shared/glyph";
import Button from "@/features/shared/components/buttons/Button";
import { AccessibleToggle } from "@/features/shared/components/forms/AccessibleToggle";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import type { ComposeConfigItem } from "@/features/agents/sub_glyph/useComposeConfig";
import type { FrameValue } from "./useFrameValues";
import type { FrameState } from "./sheetModel";
import { frameNumber } from "./sheetModel";
import { DimAuraMark, FramePicture } from "./FramePictures";
import { COPY } from "./copy";

interface FrameLayerProps {
  dim: GlyphDimension;
  label: string;
  desc: string;
  state: FrameState;
  value: FrameValue | null;
  isCompose: boolean;
  item: ComposeConfigItem | undefined;
  rows: GlyphRow[];
}

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

export function FrameLayer({ dim, label, desc, state, value, isCompose, item, rows }: FrameLayerProps) {
  const color = DIM_META[dim].color;
  const source = state === "pending" ? COPY.frame.needsYou
    : value?.by === "you" ? COPY.frame.byYou : value?.by === "ai" ? COPY.frame.byAi : COPY.frame.notSet;

  return (
    <div className="flex flex-col gap-5 max-w-[580px] w-full mx-auto">
      <div className="flex flex-col gap-1 pr-10">
        <span className="flex items-center gap-2.5 typo-caption">
          <span className="font-mono" style={{ color }}>{frameNumber(dim)}</span>
          <span className="font-semibold uppercase tracking-[0.12em]" style={{ color }}>{label}</span>
        </span>
        {desc && <p className="typo-body text-foreground">{desc}</p>}
      </div>

      <div className="flex items-center gap-4 p-4 rounded-card border" style={{ borderColor: colorWithAlpha(color, 0.35), background: colorWithAlpha(color, 0.06) }}>
        {value ? <FramePicture dim={dim} value={value} compact={false} /> : <DimAuraMark dim={dim} size={52} lit={false} />}
        <span className="flex-1 min-w-0 typo-body-lg text-foreground">{value?.caption ?? (isCompose ? COPY.frame.preLaunchNote : COPY.frame.notSet)}</span>
        <span className="typo-caption text-foreground whitespace-nowrap">{source}</span>
      </div>

      {isCompose && (
        <div className="flex items-center gap-3">
          {item?.kind === "picker" && (
            <Button variant="secondary" size="md" onClick={item.onClick}>{`${COPY.frame.choose} ${label.toLowerCase()}`}</Button>
          )}
          {item?.kind === "toggle" && (
            <label className="flex items-center gap-3 typo-body text-foreground">
              <AccessibleToggle checked={item.active} onChange={item.onClick} label={label} />
              {item.summary[0] ?? label}
            </label>
          )}
          {(!item || item.kind === "input") && <p className="typo-body text-foreground">{dim === "task" ? COPY.frame.preLaunchNote : COPY.frame.decidedLater}</p>}
        </div>
      )}

      {!isCompose && value && value.lines.length > 1 && (
        <ul className="flex flex-col gap-1.5">
          {value.lines.map((l) => <li key={l} className="typo-body text-foreground">{l}</li>)}
        </ul>
      )}

      {rows.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="typo-caption font-semibold uppercase tracking-[0.1em] text-foreground">{COPY.frame.perCapability}</span>
          {rows.map((r) => {
            const presence = r.presence[dim];
            return (
              <div key={r.id} className="flex items-start gap-3 py-2 border-b border-card-border last:border-b-0">
                <span className="typo-body text-foreground flex-1 min-w-0">{r.title}</span>
                <span className="typo-caption px-2 py-0.5 rounded-full border whitespace-nowrap" style={presence === "linked" ? { color, borderColor: colorWithAlpha(color, 0.4) } : undefined}>
                  {PRESENCE[presence] ?? presence}
                </span>
                <span className="typo-body text-foreground flex-1 min-w-0">{presence === "none" ? "" : rowDetail(dim, r)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
