/** AnnotatedLayers - the one inner layer the camera is on. A frame's layer is
 *  this variant's own DetailSheet; every other layer (the question round,
 *  context, persona core, refine, capability review, build log) is Cinema's
 *  SheetLayers unchanged, so the camera script, the keys and the question
 *  flow behave exactly as they do on the baseline. */
import { AnimatePresence } from "framer-motion";
import type { GlyphDimension } from "@/features/shared/glyph";
import type { GlyphDimText } from "@/features/shared/glyph/persona-sigil";
import type { GlyphFullLayoutProps } from "@/features/agents/sub_glyph/glyphLayoutTypes";
import { SheetLayers, type Layer } from "../cinema/SheetLayers";
import type { Shot } from "../cinema/useCamera";
import type { SheetState } from "../cinema/useSheetState";
import { COPY as CINEMA } from "../cinema/copy";
import { inkOf, notesFor } from "./annotationModel";
import { DetailSheet } from "./DetailSheet";
import { buildZones } from "./DetailZones";

interface AnnotatedLayersProps {
  p: GlyphFullLayoutProps;
  s: SheetState;
  layer: Layer | null;
  shot: Shot | null;
  scene: string;
  dimText: GlyphDimText;
  populated: Record<GlyphDimension, boolean>;
  sessionKey: string;
  close: () => void;
  drop: () => void;
  openRefine: (prefill: string | null) => void;
}

export function AnnotatedLayers({ p, s, layer, shot, scene, dimText, populated, sessionKey, close, drop, openRefine }: AnnotatedLayersProps) {
  const frame = layer?.kind === "frame" ? layer.dim : null;
  let detail: React.ReactNode = null;
  if (frame && shot) {
    const dim = frame;
    const label = dimText.label[dim];
    const value = s.values[dim];
    const rows = s.isCompose ? [] : p.glyphRows;
    // The detail is drawn fresh each time it opens, so the frame's own ink
    // state here is its data's, not where the sheet's pen happens to be.
    const ink = inkOf(s.frameStates[dim], populated[dim], true);
    detail = (
      <DetailSheet
        key={shot.key}
        shot={shot} dim={dim} label={label} ink={ink} picture={s.frameValues[dim]}
        caption={s.frameValues[dim]?.caption ?? (s.isCompose ? CINEMA.frame.preLaunchNote : CINEMA.loupe.empty)}
        notes={notesFor(dim, value, rows)}
        zones={buildZones({ dim, label, desc: dimText.desc[dim], value, isCompose: s.isCompose, item: s.cfg.items.find((i) => i.dim === dim), rows })}
        scene={scene} drawKey={`${sessionKey}:detail:${dim}`} onClose={close}
      />
    );
  }
  return (
    <>
      <SheetLayers
        p={p} s={s} layer={frame ? null : layer} shot={frame ? null : shot} scene={scene}
        dimText={dimText} close={close} drop={drop} openRefine={openRefine}
      />
      <AnimatePresence>{detail}</AnimatePresence>
    </>
  );
}
