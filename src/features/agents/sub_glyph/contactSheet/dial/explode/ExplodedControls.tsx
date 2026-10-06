/** ExplodedControls - the dimension's controls, placed in the open space
 *  beside the exploded fan and labelled the way the drawing labels things:
 *  a bus line down the column's edge (the fan's leader lands on it), and one
 *  lettered caption badge per section on a short branch. The controls are
 *  Cinema's own: QuickSetup before launch (every pick writes through the
 *  same quick config the fan is drawn from), then DecidedSetup and
 *  FrameCapabilities once the draft exists. A section with nothing to show
 *  is not drawn. */
import type { GlyphDimension, GlyphRow } from "@/features/shared/glyph";
import { DIM_META } from "@/features/shared/glyph";
import type { ComposeConfigItem } from "@/features/agents/sub_glyph/useComposeConfig";
import type { FrameValue } from "../../cinema/useFrameValues";
import { FrameCapabilities } from "../../cinema/FrameCapabilities";
import { QuickSetup, DecidedSetup, hasQuickSetup } from "../../cinema/quickSetup/QuickSetup";
import { LetteredSection, SectionBus } from "./LetteredSection";
import { COPY } from "../copy";

interface ExplodedControlsProps {
  dim: GlyphDimension;
  label: string;
  desc: string;
  value: FrameValue | null;
  isCompose: boolean;
  item: ComposeConfigItem | undefined;
  rows: GlyphRow[];
  busRef: (el: HTMLDivElement | null) => void;
}

export function ExplodedControls({ dim, label, desc, value, isCompose, item, rows, busRef }: ExplodedControlsProps) {
  const color = DIM_META[dim].color;
  const quick = isCompose && hasQuickSetup(item);
  const decided = !isCompose && !!value && ((dim === "connector" && (value.apps?.length ?? 0) > 0) || value.lines.length > 1);
  const sections: { title: string | null; node: React.ReactNode }[] = [];
  if (quick && item) sections.push({ title: COPY.fan.sections.setup, node: <QuickSetup item={item} label={label} /> });
  sections.push({
    title: COPY.fan.sections.what,
    node: (
      <>
        {desc && <p className="typo-body-lg text-foreground">{desc}</p>}
        {isCompose && !quick && <p className="typo-body text-foreground">{dim === "task" ? COPY.fan.preLaunch : COPY.fan.later}</p>}
      </>
    ),
  });
  if (decided && value) sections.push({ title: COPY.fan.sections.decided, node: <DecidedSetup dim={dim} apps={value.apps} lines={value.lines} /> });
  // FrameCapabilities letters its own heading; the badge alone labels it.
  if (rows.length > 0) sections.push({ title: null, node: <FrameCapabilities dim={dim} rows={rows} /> });

  return (
    <div className="min-h-0 h-full overflow-y-auto pr-1 flex flex-col" data-testid="dial-exploded-controls">
      <SectionBus color={color} busRef={busRef}>
        {sections.map((sec, i) => (
          <LetteredSection key={i} i={i} color={color} letter={String.fromCharCode(65 + i)} title={sec.title}>{sec.node}</LetteredSection>
        ))}
      </SectionBus>
    </div>
  );
}
