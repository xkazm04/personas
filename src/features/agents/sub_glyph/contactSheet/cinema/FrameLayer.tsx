/** FrameLayer - a frame's inner page, laid out as an enlargement beside its
 *  notes. Left: the frame's picture printed large, with its caption on a
 *  strip in the dimension's colour. Right, before launch: the dimension's
 *  inline quick setup first (vault app tiles, run rhythms, channels, other
 *  agents' events, or a toggle; the full picker modal is its "more" path),
 *  then what the frame is for. Once the draft exists: what the frame is for,
 *  what was decided, and how each capability uses it (own value, inherits
 *  agent-wide, or not used). The name, number and status live in the header. */
import type { GlyphDimension, GlyphRow } from "@/features/shared/glyph";
import { DIM_META } from "@/features/shared/glyph";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import type { ComposeConfigItem } from "@/features/agents/sub_glyph/useComposeConfig";
import type { FrameValue } from "./useFrameValues";
import type { FrameState } from "./sheetModel";
import { DimAuraMark, FramePicture } from "./FramePictures";
import { FrameCapabilities } from "./FrameCapabilities";
import { QuickSetup, DecidedSetup, hasQuickSetup } from "./quickSetup/QuickSetup";
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

export function FrameLayer({ dim, label, desc, value, isCompose, item, rows }: FrameLayerProps) {
  return (
    <div className="grid gap-6 2xl:gap-10 w-full max-w-[980px] 2xl:max-w-[1180px] mx-auto my-auto grid-cols-1 sm:grid-cols-[minmax(220px,300px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(260px,380px)_minmax(0,1fr)]">
      <FramePrint dim={dim} value={value} isCompose={isCompose} />
      <div className="flex flex-col gap-4 min-w-0">
        {isCompose && item && hasQuickSetup(item) ? (
          <>
            <QuickSetup item={item} label={label} />
            {desc && <p className="typo-body text-foreground">{desc}</p>}
          </>
        ) : (
          <>
            {desc && <p className="typo-body-lg text-foreground">{desc}</p>}
            {isCompose && <p className="typo-body text-foreground">{dim === "task" ? COPY.frame.preLaunchNote : COPY.frame.decidedLater}</p>}
          </>
        )}
        {!isCompose && value && <DecidedSetup dim={dim} apps={value.apps} lines={value.lines} />}
        {rows.length > 0 && <FrameCapabilities dim={dim} rows={rows} />}
      </div>
    </div>
  );
}
