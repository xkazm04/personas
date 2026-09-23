/** SheetLayers - the one inner layer the camera is on, if any. The question
 *  round's layer is driven by the question flow; every other layer (a frame's
 *  page, context, refine, capability review) by the sheet. `layerShot` names
 *  the camera target for either; the layout runs it through `useCamera`, so a
 *  hand-over between two layers always pulls out to the sheet first and this
 *  component only ever renders the layer the camera has actually arrived at. */
import { AnimatePresence } from "framer-motion";
import type { GlyphDimension } from "@/features/shared/glyph";
import { DIM_META } from "@/features/shared/glyph";
import type { GlyphDimText } from "@/features/shared/glyph/persona-sigil";
import { CELL_KEY_TO_DIM } from "@/features/agents/sub_glyph/glyphLayoutHelpers";
import type { GlyphFullLayoutProps } from "@/features/agents/sub_glyph/glyphLayoutTypes";
import { Loupe } from "./Loupe";
import type { LoupeHead } from "./LoupeHeader";
import { QuestionLayer } from "./QuestionLayer";
import { FrameLayer, frameStatus } from "./FrameLayer";
import { ContextLayer, RefineLayer, CapsLayer } from "./MiscLayers";
import { shotAt, type Rect, type Shot } from "./useCamera";
import type { SheetState } from "./useSheetState";
import { frameNumber } from "./sheetModel";
import { COPY } from "./copy";

export type Layer =
  | { kind: "frame"; dim: GlyphDimension; from: Rect }
  | { kind: "context"; from: Rect }
  | { kind: "refine"; prefill: string | null; from: Rect }
  | { kind: "caps"; from: Rect };

const CENTRE_CODE = "00";

/** Where the camera should be: the open layer, else the question being asked. */
export function layerShot(layer: Layer | null, s: SheetState, questionOpen: boolean, frameRect: (d: GlyphDimension | null) => Rect): Shot | null {
  if (layer) return shotAt(layer.kind === "frame" ? `frame-${layer.dim}` : layer.kind, layer.from);
  const q = questionOpen ? s.flow.current : null;
  if (!q) return null;
  return shotAt(`q-${s.flow.qi}-${q.cellKey}`, frameRect(CELL_KEY_TO_DIM[q.cellKey] ?? null));
}

interface SheetLayersProps {
  p: GlyphFullLayoutProps;
  s: SheetState;
  layer: Layer | null;
  shot: Shot | null;
  scene: string;
  dimText: GlyphDimText;
  close: () => void;
  openRefine: (prefill: string | null) => void;
}

export function SheetLayers({ p, s, layer, shot, scene, dimText, close, openRefine }: SheetLayersProps) {
  const { flow } = s;
  const accent = s.cast.accent;
  const centre = (title: string, status: LoupeHead["status"] = null): LoupeHead => ({ code: CENTRE_CODE, title, status, context: scene });
  let node: React.ReactNode = null;

  if (!shot) node = null;
  else if (layer?.kind === "frame") {
    const dim = layer.dim;
    const label = dimText.label[dim];
    const head: LoupeHead = { code: frameNumber(dim), title: label, status: frameStatus(s.frameStates[dim], s.values[dim]), context: scene };
    node = (
      <Loupe key={shot.key} shot={shot} color={DIM_META[dim].color} head={head} onClose={close}>
        <FrameLayer
          dim={dim} label={label} desc={dimText.desc[dim]} value={s.values[dim]}
          isCompose={s.isCompose} item={s.cfg.items.find((i) => i.dim === dim)} rows={s.isCompose ? [] : p.glyphRows}
        />
      </Loupe>
    );
  } else if (layer?.kind === "context") {
    const added = (p.contextText ?? "").trim() ? { label: COPY.contextAdded, strong: false } : null;
    node = (
      <Loupe key={shot.key} shot={shot} color={accent} head={centre(COPY.context, added)} onClose={close}>
        <ContextLayer value={p.contextText ?? ""} onChange={p.onContextChange} onDone={close} />
      </Loupe>
    );
  } else if (layer?.kind === "refine") {
    node = (
      <Loupe key={shot.key} shot={shot} color={accent} head={centre(COPY.refine)} onClose={close}>
        <RefineLayer prefill={layer.prefill} onCancel={close} onSubmit={(v) => { close(); void p.onRefine?.(v); }} />
      </Loupe>
    );
  } else if (layer?.kind === "caps") {
    node = (
      <Loupe key={shot.key} shot={shot} color={accent} head={centre(COPY.capabilities)} onClose={close}>
        <CapsLayer onRequestSplit={(_t, prompt) => openRefine(prompt)} />
      </Loupe>
    );
  } else if (flow.current) {
    const q = flow.current;
    const dim = CELL_KEY_TO_DIM[q.cellKey] ?? null;
    const label = dim ? dimText.label[dim] : q.cellKey.replace(/-/g, " ");
    const head: LoupeHead = {
      code: dim ? frameNumber(dim) : CENTRE_CODE,
      title: label,
      status: { label: COPY.loupe.needsYou, strong: true },
      context: COPY.loupe.questionOf(flow.qi + 1, flow.n),
    };
    node = (
      <Loupe key={shot.key} shot={shot} color={dim ? DIM_META[dim].color : accent} head={head} onClose={flow.pullBack}>
        <QuestionLayer
          question={q} dim={dim} index={flow.qi} total={flow.n}
          draft={flow.draftOf(q)} onDraft={(v) => flow.setDraft(q, v)} onPick={flow.pick} onNext={flow.next} onPrev={flow.prev}
        />
      </Loupe>
    );
  }

  return <AnimatePresence>{node}</AnimatePresence>;
}
