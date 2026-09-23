/** SheetLayers — the one inner layer the camera is pushed into, if any. The
 *  question round's layer is driven by the question flow; every other layer
 *  (a frame's page, context, refine, capability review) by the sheet. Layers
 *  swap with `mode="wait"`, so each pull-back lands in its frame before the
 *  next push-in leaves from the next one. */
import { AnimatePresence } from "framer-motion";
import type { GlyphDimension } from "@/features/shared/glyph";
import { DIM_META } from "@/features/shared/glyph";
import type { GlyphDimText } from "@/features/shared/glyph/persona-sigil";
import { CELL_KEY_TO_DIM } from "@/features/agents/sub_glyph/glyphLayoutHelpers";
import type { GlyphFullLayoutProps } from "@/features/agents/sub_glyph/glyphLayoutTypes";
import { PushLayer, type Rect } from "./PushLayer";
import { QuestionLayer } from "./QuestionLayer";
import { FrameLayer } from "./FrameLayer";
import { ContextLayer, RefineLayer, CapsLayer } from "./MiscLayers";
import type { SheetState } from "./useSheetState";
import { COPY } from "./copy";

export type Layer =
  | { kind: "frame"; dim: GlyphDimension; from: Rect }
  | { kind: "context"; from: Rect }
  | { kind: "refine"; prefill: string | null; from: Rect }
  | { kind: "caps"; from: Rect };

interface SheetLayersProps {
  p: GlyphFullLayoutProps;
  s: SheetState;
  layer: Layer | null;
  questionOpen: boolean;
  stage: { w: number; h: number };
  dimText: GlyphDimText;
  frameRect: (dim: GlyphDimension | null) => Rect;
  close: () => void;
  openRefine: (prefill: string | null) => void;
}

export function SheetLayers({ p, s, layer, questionOpen, stage, dimText, frameRect, close, openRefine }: SheetLayersProps) {
  const { flow } = s;
  const accent = s.cast.accent;
  let node: React.ReactNode = null;

  if (layer?.kind === "frame") {
    const dim = layer.dim;
    node = (
      <PushLayer key={`frame-${dim}`} from={layer.from} stage={stage} color={DIM_META[dim].color} label={dimText.label[dim]} onClose={close}>
        <FrameLayer
          dim={dim} label={dimText.label[dim]} desc={dimText.desc[dim]} state={s.frameStates[dim]} value={s.values[dim]}
          isCompose={s.isCompose} item={s.cfg.items.find((i) => i.dim === dim)} rows={s.isCompose ? [] : p.glyphRows}
        />
      </PushLayer>
    );
  } else if (layer?.kind === "context") {
    node = (
      <PushLayer key="context" from={layer.from} stage={stage} color={accent} label={COPY.context} onClose={close}>
        <ContextLayer value={p.contextText ?? ""} onChange={p.onContextChange} onDone={close} />
      </PushLayer>
    );
  } else if (layer?.kind === "refine") {
    node = (
      <PushLayer key="refine" from={layer.from} stage={stage} color={accent} label={COPY.refine} onClose={close}>
        <RefineLayer prefill={layer.prefill} onCancel={close} onSubmit={(v) => { close(); void p.onRefine?.(v); }} />
      </PushLayer>
    );
  } else if (layer?.kind === "caps") {
    node = (
      <PushLayer key="caps" from={layer.from} stage={stage} color={accent} label={COPY.capabilities} onClose={close}>
        <CapsLayer onRequestSplit={(_t, prompt) => openRefine(prompt)} />
      </PushLayer>
    );
  } else if (questionOpen && flow.current) {
    const q = flow.current;
    const dim = CELL_KEY_TO_DIM[q.cellKey] ?? null;
    const label = dim ? dimText.label[dim] : q.cellKey.replace(/-/g, " ");
    node = (
      <PushLayer key={`q-${flow.qi}-${q.cellKey}`} from={frameRect(dim)} stage={stage} color={dim ? DIM_META[dim].color : accent} label={label} onClose={flow.pullBack}>
        <QuestionLayer
          question={q} dim={dim} label={label} index={flow.qi} total={flow.n}
          draft={flow.draftOf(q)} onDraft={(v) => flow.setDraft(q, v)} onPick={flow.pick} onNext={flow.next} onPrev={flow.prev}
        />
      </PushLayer>
    );
  }

  return <AnimatePresence mode="wait">{node}</AnimatePresence>;
}
