/** ExplodedControls - the dimension's controls, placed in the open space
 *  beside the exploded fan and labelled the way the drawing labels things:
 *  a bus line down the column's edge (the fan's leader lands on it), and one
 *  lettered caption badge per section on a short branch. The controls are
 *  Cinema's own: QuickSetup before launch (every pick writes through the
 *  same quick config the fan is drawn from), then DecidedSetup and
 *  FrameCapabilities once the draft exists. A section with nothing to show
 *  is not drawn. */
import { motion } from "framer-motion";
import type { GlyphDimension, GlyphRow } from "@/features/shared/glyph";
import { useMotion } from "@/hooks/utility/interaction/useMotion";
import type { ComposeConfigItem } from "@/features/agents/sub_glyph/useComposeConfig";
import { LETTERING } from "../../blueprint";
import type { FrameValue } from "../../cinema/useFrameValues";
import { FrameCapabilities } from "../../cinema/FrameCapabilities";
import { QuickSetup, DecidedSetup, hasQuickSetup } from "../../cinema/quickSetup/QuickSetup";
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

function Section({ letter, title, i, children }: { letter: string; title: string | null; i: number; children: React.ReactNode }) {
  const { shouldAnimate } = useMotion();
  return (
    <motion.section
      className="relative flex flex-col gap-2 pl-5"
      initial={shouldAnimate ? { opacity: 0, x: 14 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.45, delay: 0.55 + i * 0.12, ease: "easeOut" }}
    >
      <span aria-hidden className="absolute -left-px top-[11px] h-px w-3" style={{ background: "var(--ink-dim)" }} />
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
          style={{ ...LETTERING, letterSpacing: 0, fontSize: 10, background: "var(--ink)", color: "var(--background)" }}
        >
          {letter}
        </span>
        {title && <span style={{ ...LETTERING, color: "var(--ink-strong)" }}>{title}</span>}
      </span>
      {children}
    </motion.section>
  );
}

export function ExplodedControls({ dim, label, desc, value, isCompose, item, rows, busRef }: ExplodedControlsProps) {
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
      <div ref={busRef} className="relative my-auto flex flex-col gap-5 py-1" style={{ borderLeft: "1px solid var(--ink-dim)" }}>
        {sections.map((sec, i) => (
          <Section key={i} i={i} letter={String.fromCharCode(65 + i)} title={sec.title}>{sec.node}</Section>
        ))}
      </div>
    </div>
  );
}
