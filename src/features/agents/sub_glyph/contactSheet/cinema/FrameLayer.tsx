/** FrameLayer - a frame's inner page, laid out as an enlargement beside its
 *  notes. Left: the frame's picture printed large, with its caption on a
 *  strip in the dimension's colour. Right: what the frame
 *  is for, then before launch that dimension's setting (the real composer
 *  pickers, opened as modals, or a toggle), or once the draft exists its
 *  detail lines and how each capability uses it (own value, inherits
 *  agent-wide, or not used). The name, number and status live in the header. */
import type { GlyphDimension, GlyphRow } from "@/features/shared/glyph";
import { DIM_META } from "@/features/shared/glyph";
import Button from "@/features/shared/components/buttons/Button";
import { AccessibleToggle } from "@/features/shared/components/forms/AccessibleToggle";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import type { ComposeConfigItem } from "@/features/agents/sub_glyph/useComposeConfig";
import type { FrameValue } from "./useFrameValues";
import type { FrameState } from "./sheetModel";
import { DimAuraMark, FramePicture } from "./FramePictures";
import { FrameCapabilities } from "./FrameCapabilities";
import { COPY } from "./copy";

interface FrameLayerProps {
  dim: GlyphDimension;
  label: string;
  desc: string;
  value: FrameValue | null;
  isCompose: boolean;
  item: ComposeConfigItem | undefined;
  rows: GlyphRow[];
}

/** The header's status chip for a frame. */
export function frameStatus(state: FrameState, value: FrameValue | null): { label: string; strong: boolean } {
  if (state === "pending") return { label: COPY.frame.needsYou, strong: true };
  if (state === "error") return { label: COPY.frame.error, strong: false };
  if (state === "filling") return { label: COPY.frame.developing, strong: false };
  if (value?.by === "you") return { label: COPY.frame.byYou, strong: false };
  if (value?.by === "ai") return { label: COPY.frame.byAi, strong: false };
  return { label: COPY.frame.notSet, strong: false };
}

function FramePrint({ dim, value, isCompose }: { dim: GlyphDimension; value: FrameValue | null; isCompose: boolean }) {
  const color = DIM_META[dim].color;
  return (
    <figure className="m-0 flex flex-col gap-2 min-w-0">
      <div
        className="relative flex items-center justify-center rounded-card overflow-hidden"
        style={{
          aspectRatio: "4 / 3",
          background: `radial-gradient(ellipse at 50% 42%, ${colorWithAlpha(color, 0.12)}, transparent 72%), color-mix(in srgb, var(--foreground) 3%, transparent)`,
          boxShadow: `0 0 0 1px ${colorWithAlpha(color, 0.3)}, 0 20px 40px -24px rgba(0,0,0,0.6)`,
        }}
      >
        <span className="scale-125 2xl:scale-150 origin-center">
          {value ? <FramePicture dim={dim} value={value} compact={false} /> : <DimAuraMark dim={dim} size={56} lit={false} />}
        </span>
      </div>
      <figcaption className="typo-body text-foreground truncate pl-2" style={{ borderLeft: `3px solid ${color}` }}>
        {value?.caption ?? (isCompose ? COPY.frame.preLaunchNote : COPY.loupe.empty)}
      </figcaption>
    </figure>
  );
}

function ComposeSetting({ dim, label, item }: { dim: GlyphDimension; label: string; item: ComposeConfigItem | undefined }) {
  if (item?.kind === "picker") {
    return (
      <Button variant="secondary" size="md" className="self-start" onClick={item.onClick}>
        {`${COPY.frame.choose} ${label.toLowerCase()}`}
      </Button>
    );
  }
  if (item?.kind === "toggle") {
    return (
      <label className="flex items-center gap-3 typo-body text-foreground">
        <AccessibleToggle checked={item.active} onChange={item.onClick} label={label} />
        {item.summary[0] ?? label}
      </label>
    );
  }
  return <p className="typo-body text-foreground">{dim === "task" ? COPY.frame.preLaunchNote : COPY.frame.decidedLater}</p>;
}

export function FrameLayer({ dim, label, desc, value, isCompose, item, rows }: FrameLayerProps) {
  return (
    <div className="grid gap-6 2xl:gap-10 w-full max-w-[980px] 2xl:max-w-[1180px] mx-auto my-auto grid-cols-1 sm:grid-cols-[minmax(220px,300px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(260px,380px)_minmax(0,1fr)]">
      <FramePrint dim={dim} value={value} isCompose={isCompose} />
      <div className="flex flex-col gap-4 min-w-0">
        {desc && <p className="typo-body-lg text-foreground">{desc}</p>}
        {isCompose && <ComposeSetting dim={dim} label={label} item={item} />}
        {!isCompose && value && value.lines.length > 1 && (
          <ul className="flex flex-col gap-1.5">
            {value.lines.map((l) => <li key={l} className="typo-body text-foreground">{l}</li>)}
          </ul>
        )}
        {rows.length > 0 && <FrameCapabilities dim={dim} rows={rows} />}
      </div>
    </div>
  );
}
