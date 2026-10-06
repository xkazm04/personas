/** MainSheet - sheet 1 of 9: the persona drawing beside its title block, and
 *  the pen. The pen goes to the part drawn last while the sheet builds up,
 *  else to the region the build is filling (or asking about), else to the
 *  notes while the build works, writing a callout for each step it draws and
 *  for each new line of the build's output.
 *
 *  Memoised to sleep like Cinema's print: while the camera is pushed into a
 *  layer, or the sheet has turned to a dimension's sheet, it holds its last
 *  awake render (`frozen`) and wakes with everything that changed meanwhile. */
import { memo, useRef } from "react";
import type { GlyphDimension } from "@/features/shared/glyph";
import { GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import type { GlyphFullLayoutProps } from "@/features/agents/sub_glyph/glyphLayoutTypes";
import type { SheetState } from "../cinema/useSheetState";
import type { CentreActions } from "../cinema/centre/ActPanel";
import { BlueprintPen, LETTERING } from "../blueprint";
import type { Ink } from "./sheetGeometry";
import type { DraftingSequence } from "./useDraftingSequence";
import { SheetShell } from "./SheetShell";
import { PersonaDrawing } from "./PersonaDrawing";
import { TitleBlock } from "./TitleBlock";
import { COPY } from "./copy";

interface MainSheetProps {
  p: GlyphFullLayoutProps;
  s: SheetState;
  a: CentreActions;
  seq: DraftingSequence;
  inks: Record<GlyphDimension, Ink>;
  labels: Record<GlyphDimension, string>;
  refFor: (id: string) => (el: HTMLElement | null) => void;
  els: Record<string, HTMLElement | null>;
  onOpen: (dim: GlyphDimension) => void;
  scene: string;
  stamp: { text: string; tone: string } | null;
  dock: React.ReactNode;
  /** Asleep: keep the last awake render. */
  frozen: boolean;
}

function MainSheetImpl({ p, s, a, seq, inks, labels, refFor, els, onOpen, scene, stamp, dock }: MainSheetProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const lines = p.cliOutputLines ?? [];
  const working = seq.building || p.isBuilding || s.act === "screening";

  // Where the pen is: the step drawn last, else the frame in work, else the notes.
  const last = seq.last;
  const busy = GLYPH_DIMENSIONS.find((d) => inks[d] === "drafting") ?? GLYPH_DIMENSIONS.find((d) => inks[d] === "asking") ?? null;
  const targetId = last
    ? last.kind === "brief" ? "brief" : `region:${last.dim}`
    : busy && seq.drawn.has(busy) ? `region:${busy}` : working ? "notes" : null;
  const target = (targetId ? els[targetId] : null) ?? null;

  const lastLine = lines[lines.length - 1];
  const callout = last
    ? {
        id: `${seq.key}#${seq.count}`,
        kind: last.kind === "region" ? COPY.pen.draw : last.kind === "ink" ? COPY.pen.ink : COPY.pen.letter,
        text: last.kind === "brief" ? COPY.cell.brief
          : last.kind === "ink" && s.frameValues[last.dim]?.caption ? `${labels[last.dim]} · ${s.frameValues[last.dim]!.caption}`
          : labels[last.dim],
      }
    : p.isBuilding && lastLine ? { id: `log#${lines.length}`, kind: COPY.pen.build, text: lastLine } : null;

  return (
    <SheetShell
      rootRef={rootRef}
      number={1}
      testId="drafting-sheet-1"
      heading={<span style={{ ...LETTERING, color: "var(--ink-strong)" }}>{COPY.drawing}</span>}
      overlay={<BlueprintPen rootRef={rootRef} target={target} working={working} callout={callout} />}
    >
      <PersonaDrawing p={p} s={s} a={a} seq={seq} inks={inks} labels={labels} refFor={refFor} onOpen={onOpen} />
      <TitleBlock p={p} s={s} seq={seq} scene={scene} inks={inks} labels={labels} refFor={refFor} onOpen={onOpen} stamp={stamp} dock={dock} />
    </SheetShell>
  );
}

export const MainSheet = memo(MainSheetImpl, (_prev, next) => next.frozen);
