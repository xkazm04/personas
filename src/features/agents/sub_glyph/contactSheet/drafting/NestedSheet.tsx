/** NestedSheet - "Sheet n of 9": one dimension drawn as its own sheet, in the
 *  same shell as sheet 1 (the recursion is the point). Its parts are built up
 *  one beat apart under the pen, its title block holds the SPECIFICATION
 *  controls, and the header turns back to sheet 1 (Esc) or to the
 *  neighbouring dimension's sheet. The page turn itself is the layout's. */
import { useRef, useState, useCallback } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import type { GlyphDimension } from "@/features/shared/glyph";
import { DIM_META } from "@/features/shared/glyph";
import type { GlyphDimText } from "@/features/shared/glyph/persona-sigil";
import Button from "@/features/shared/components/buttons/Button";
import type { GlyphFullLayoutProps } from "@/features/agents/sub_glyph/glyphLayoutTypes";
import type { SheetState } from "../cinema/useSheetState";
import { COPY as CINEMA } from "../cinema/copy";
import { BlueprintPen, LETTERING, useDraftSteps } from "../blueprint";
import { dimNumber, inkOf } from "./sheetGeometry";
import { subParts } from "./subParts";
import { SheetShell } from "./SheetShell";
import { DimensionDrawing } from "./DimensionDrawing";
import { DimensionBlock } from "./DimensionBlock";
import { COPY } from "./copy";

interface NestedSheetProps {
  dim: GlyphDimension;
  p: GlyphFullLayoutProps;
  s: SheetState;
  dimText: GlyphDimText;
  populated: boolean;
  /** The sheet-1 drawing key; this sheet's build-up keys off it. */
  drawKey: string;
  onBack: () => void;
  onTurn: (dir: 1 | -1) => void;
}

export function NestedSheet({ dim, p, s, dimText, populated, drawKey, onBack, onTurn }: NestedSheetProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [els, setEls] = useState<Record<number, HTMLElement | null>>({});
  const [specEl, setSpecEl] = useState<HTMLElement | null>(null);
  const [refs] = useState(() => new Map<number, (el: HTMLElement | null) => void>());
  const partRef = useCallback((i: number) => {
    let fn = refs.get(i);
    if (!fn) {
      fn = (el) => setEls((m) => (m[i] === el ? m : { ...m, [i]: el }));
      refs.set(i, fn);
    }
    return fn;
  }, [refs]);

  const n = dimNumber(dim);
  const label = dimText.label[dim];
  const value = s.frameValues[dim];
  const ink = inkOf(s.frameStates[dim], populated);
  const { parts, more } = subParts(dim, value);
  const shown = useDraftSteps(`${drawKey}:sheet-${dim}`, parts.length);
  const building = shown < parts.length;
  const last = building && shown > 0 ? parts[shown - 1] : null;
  const callout = last ? { id: `${dim}#${shown}`, kind: COPY.pen.draw, text: last.title } : null;

  return (
    <SheetShell
      rootRef={rootRef}
      number={n + 1}
      testId={`drafting-sheet-${dim}`}
      lead={
        <Button variant="secondary" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={onBack} aria-label={COPY.nested.back} data-testid="drafting-sheet-back">
          <kbd className="rounded-interactive px-1 font-mono typo-caption text-foreground">{CINEMA.loupe.esc}</kbd>
        </Button>
      }
      heading={<span style={{ ...LETTERING, color: DIM_META[dim].color }}>{`${n} · ${label}`}</span>}
      trail={
        <span className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon-sm" icon={<ChevronLeft className="h-4 w-4" />} onClick={() => onTurn(-1)} aria-label={COPY.nested.prev} />
          <Button variant="ghost" size="icon-sm" icon={<ChevronRight className="h-4 w-4" />} onClick={() => onTurn(1)} aria-label={COPY.nested.next} />
        </span>
      }
      overlay={<BlueprintPen rootRef={rootRef} target={last ? els[shown - 1] ?? null : specEl} working={building} callout={callout} />}
    >
      <DimensionDrawing dim={dim} n={n} ink={ink} parts={parts} more={more} shown={shown} caption={value?.caption ?? null} partRef={partRef} />
      <DimensionBlock
        dim={dim} label={label} desc={dimText.desc[dim]} state={s.frameStates[dim]} value={value}
        isCompose={s.isCompose} item={s.cfg.items.find((i) => i.dim === dim)} rows={s.isCompose ? [] : p.glyphRows}
        specRef={setSpecEl}
      />
    </SheetShell>
  );
}
