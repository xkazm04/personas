/** DimensionBlock - the title block of a dimension's own sheet, the same
 *  block as sheet 1's one level down: DIMENSION and STATUS on top, the VALUE
 *  (the region's caption, lettered), its PURPOSE, and the SPECIFICATION cell
 *  with exactly the controls Cinema's frame page offers. Before launch: the
 *  dimension's inline quick setup (or the note that the build decides it).
 *  After launch: what was decided, and how each capability uses it. */
import type { GlyphDimension, GlyphRow } from "@/features/shared/glyph";
import { DIM_META } from "@/features/shared/glyph";
import { useMotion } from "@/hooks/utility/interaction/useMotion";
import { motion } from "framer-motion";
import type { ComposeConfigItem } from "@/features/agents/sub_glyph/useComposeConfig";
import { COPY as CINEMA } from "../cinema/copy";
import type { FrameValue } from "../cinema/useFrameValues";
import type { FrameState } from "../cinema/sheetModel";
import { frameStatus } from "../cinema/FrameLayer";
import { FrameCapabilities } from "../cinema/FrameCapabilities";
import { QuickSetup, DecidedSetup, hasQuickSetup } from "../cinema/quickSetup/QuickSetup";
import { Cell } from "./sheetParts";
import { COPY } from "./copy";

interface DimensionBlockProps {
  dim: GlyphDimension;
  label: string;
  desc: string;
  state: FrameState;
  value: FrameValue | null;
  isCompose: boolean;
  item: ComposeConfigItem | undefined;
  rows: GlyphRow[];
  specRef: (el: HTMLElement | null) => void;
}

export function DimensionBlock({ dim, label, desc, state, value, isCompose, item, rows, specRef }: DimensionBlockProps) {
  const { shouldAnimate } = useMotion();
  const color = DIM_META[dim].color;
  const status = frameStatus(state, value);
  const quick = isCompose && hasQuickSetup(item);
  const decided = !isCompose && !!value && ((dim === "connector" && (value.apps?.length ?? 0) > 0) || value.lines.length > 1);
  const spec = isCompose || decided || rows.length > 0;

  return (
    <motion.div
      initial={shouldAnimate ? { clipPath: "inset(0 0 100% 0)", opacity: 0.4 } : false}
      animate={{ clipPath: "inset(0 0 0% 0)", opacity: 1 }}
      transition={{ duration: 0.7, ease: "easeOut" }}
      className="relative flex min-h-0 min-w-0 flex-col"
      style={{ border: "1px solid var(--ink)", background: "color-mix(in srgb, var(--background) 82%, transparent)" }}
      data-testid="drafting-dimension-block"
    >
      <div className="grid shrink-0 grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Cell label={COPY.cell.dimension}>
          <p className="truncate typo-heading-lg uppercase tracking-[0.08em]" style={{ color }}>{label}</p>
        </Cell>
        <Cell label={COPY.cell.status}>
          <p className={`truncate typo-body ${status.strong ? "text-status-warning" : "text-foreground"}`}>{status.label}</p>
        </Cell>
      </div>
      {value?.caption && (
        <Cell label={COPY.cell.value} className="shrink-0">
          <p className="line-clamp-2 typo-body text-foreground">{value.caption}</p>
        </Cell>
      )}
      {desc && (
        <Cell label={COPY.cell.purpose} className="shrink-0">
          <p className="line-clamp-3 typo-body text-foreground">{desc}</p>
        </Cell>
      )}
      {spec && (
        <Cell label={COPY.cell.specification} className="flex-1" cellRef={specRef}>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1 pt-1">
            {quick && item && <QuickSetup item={item} label={label} />}
            {isCompose && !quick && <p className="typo-body text-foreground">{dim === "task" ? CINEMA.frame.preLaunchNote : CINEMA.frame.decidedLater}</p>}
            {decided && value && <DecidedSetup dim={dim} apps={value.apps} lines={value.lines} />}
            {rows.length > 0 && <FrameCapabilities dim={dim} rows={rows} />}
          </div>
        </Cell>
      )}
    </motion.div>
  );
}
