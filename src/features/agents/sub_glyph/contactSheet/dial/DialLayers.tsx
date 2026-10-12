/** DialLayers - which exploded view is out, if any. A sector click pulls its
 *  sector out beside the dimension's controls; the question round pulls out
 *  the sector being asked about beside the question (Cinema pushes its camera
 *  into a frame instead). Questions in a row about one dimension keep the
 *  same view, and only the question in its column changes; a question about
 *  another dimension re-seats one sector and pulls out the next. */
import { AnimatePresence } from "framer-motion";
import type { GlyphDimension, GlyphRow } from "@/features/shared/glyph";
import { DIM_META } from "@/features/shared/glyph";
import type { GlyphDimText } from "@/features/shared/glyph/persona-sigil";
import { CELL_KEY_TO_DIM } from "@/features/agents/sub_glyph/glyphLayoutHelpers";
import type { SheetState } from "../cinema/useSheetState";
import { frameStatus } from "../cinema/FrameLayer";
import { COPY as CINEMA } from "../cinema/copy";
import type { DialLayout } from "./dialGeometry";
import { partsOf } from "./dialMarks";
import type { DialDrawing } from "./useDialMarks";
import { ExplodedLayer } from "./explode/ExplodedLayer";
import { ExplodedControls } from "./explode/ExplodedControls";
import { DialQuestion } from "./question/DialQuestion";
import { THEME_INK } from "./tint";

interface DialLayersProps {
  s: SheetState;
  rows: GlyphRow[];
  /** The sector a click pulled out. */
  exploded: GlyphDimension | null;
  /** The question round is asking (and no other layer is open). */
  asking: boolean;
  layout: DialLayout;
  stage: { w: number; h: number };
  drawing: DialDrawing;
  populated: Record<GlyphDimension, boolean>;
  drawKey: string;
  scene: string;
  dimText: GlyphDimText;
  onClose: () => void;
}

export function DialLayers({ s, rows, exploded, asking, layout, stage, drawing, populated, drawKey, scene, dimText, onClose }: DialLayersProps) {
  const { flow } = s;
  const q = asking && !exploded ? flow.current : null;
  let node: React.ReactNode = null;

  if (exploded) {
    const dim = exploded;
    node = (
      <ExplodedLayer
        key={`x-${dim}`} dim={dim} layout={layout} stage={stage} testId="dial-exploded"
        head={{ label: dimText.label[dim], status: frameStatus(s.frameStates[dim], s.values[dim]), caption: s.frameValues[dim]?.caption, context: scene }}
        ink={drawing.ink[dim]} populated={populated[dim]} parts={partsOf(dim, s.frameValues[dim])} drawKey={drawKey} onClose={onClose}
        side={(busRef) => (
          <ExplodedControls
            dim={dim} label={dimText.label[dim]} desc={dimText.desc[dim]} value={s.values[dim]} isCompose={s.isCompose}
            item={s.cfg.items.find((i) => i.dim === dim)} rows={rows} busRef={busRef}
          />
        )}
      />
    );
  } else if (q) {
    const dim = CELL_KEY_TO_DIM[q.cellKey] ?? null;
    node = (
      <ExplodedLayer
        key={`q-${dim ?? "centre"}`} dim={dim} layout={layout} stage={stage} testId="dial-question-layer"
        head={{ label: dim ? dimText.label[dim] : q.cellKey.replace(/-/g, " "), status: { label: CINEMA.loupe.needsYou, strong: true }, context: scene }}
        ink={dim ? drawing.ink[dim] : "pending"} populated={dim ? populated[dim] : false}
        parts={dim ? partsOf(dim, s.frameValues[dim]) : []} drawKey={drawKey} onClose={flow.pullBack}
        side={(busRef) => (
          <DialQuestion
            qs={flow.qs} index={flow.qi} color={dim ? DIM_META[dim].color : THEME_INK} draftOf={flow.draftOf}
            onDraft={(v) => flow.setDraft(q, v)} onPick={flow.pick} onNext={flow.next} onPrev={flow.prev} busRef={busRef}
          />
        )}
      />
    );
  }

  return <AnimatePresence>{node}</AnimatePresence>;
}
