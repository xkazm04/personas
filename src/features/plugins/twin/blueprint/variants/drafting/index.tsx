/**
 * Blueprint variant "drafting" (spark twin-portable-blueprint, WP7; round 2:
 * the draw-in): the twin drawn as a technical drawing on Studio's cyanotype
 * sheet. Four regions laid out like a plan, each an inked drawing of its
 * quantities, with a title block in the corner. Pending parts are dashed,
 * finished ones solid ink, unmeasured ones hatched. L2 zooms one region to
 * fill the sheet; stage mode keeps the middle open for the card and lets the
 * pen ink in where each answer lands. Contract: `BlueprintVariantProps`.
 *
 * Every sheet draws itself in as a draughtsman would (engine: `./draw`):
 * frames first, level by level, then each container's content in reading
 * order. L1 draws on this mount's first look at it (a visit to the page, a
 * variant switch) and is simply there back from a zoom; every zoom draws
 * itself; the stage draws once when the overlay opens, and an answer's delta
 * plays on the drawn sheet.
 */
import { useEffect, useRef, useState } from 'react';
import '@/features/studio/guide/drafting/drafting.css';
import type { BlueprintVariantProps, SectionId } from '../../blueprintContract';
import FocusSheet from './FocusSheet';
import OverviewSheet, { type SheetDraw } from './OverviewSheet';
import SheetBorder from './SheetBorder';
import SheetPen, { type SheetPenHandle } from './SheetPen';
import StageNotes from './StageNotes';
import StageSheet from './StageSheet';
import { deltaTarget } from './draftingTwinModel';
import LeaderLine from './LeaderLine';
import { useLeaderEnds, useMarkRegistry } from './useSheetPen';
import { useRoomySheet } from './useRoomySheet';
import { insetsWithin, type Insets } from './zoomOrigin';
import './twinDrafting.css';

export default function DraftingBlueprint({ model, mode, focus, onFocus, onOpenDetail, delta, working, reduced }: BlueprintVariantProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const pen = useRef<SheetPenHandle>(null);
  /** Where the zoom grows from: the activated region's box inside the sheet, for that section only. */
  const [origin, setOrigin] = useState<{ section: SectionId; box: Insets | null } | null>(null);
  const { register, find } = useMarkRegistry();
  const roomy = useRoomySheet(rootRef);
  const stage = mode === 'stage';
  const zoom: SectionId | null = stage ? null : focus;

  // L1 has been seen once this mount has zoomed: back from a zoom it is simply there.
  const [zoomed, setZoomed] = useState(zoom !== null);
  if (zoom !== null && !zoomed) setZoomed(true);

  // Stage: the delta waits for the sheet to stand. One that arrives while it
  // still draws (an answer within the first seconds) finishes the drawing.
  const [stageDrawn, setStageDrawn] = useState(false);
  const playKey = delta ? `${delta.answeredStepId}:${delta.phase}` : null;
  const [mountKey] = useState(playKey);
  const shown = stage && (reduced || stageDrawn) ? delta : null;
  const finish = stage && playKey !== null && playKey !== mountKey;
  const target = shown ? deltaTarget(shown, model) : null;
  const leader = useLeaderEnds(target?.key ?? null, stageDrawn, find);

  const draw: SheetDraw = {
    instant: reduced,
    onPlan: (plan, t0) => pen.current?.draw(plan, t0),
    onDone: () => pen.current?.lift(),
    onLeave: () => pen.current?.lift(),
  };

  const zoomInto = (section: SectionId) => {
    setOrigin({ section, box: insetsWithin(find(`region:${section}`), viewRef.current) });
    onFocus(section);
  };

  // Back from a zoom, the keyboard lands on the region it came from.
  const lastZoom = useRef<SectionId | null>(null);
  useEffect(() => {
    if (zoom === null && lastZoom.current) find(`region:${lastZoom.current}`)?.focus({ preventScroll: true });
    lastZoom.current = zoom;
  }, [zoom, find]);

  return (
    <div
      ref={rootRef}
      className="drafting-root twd-sheet relative flex min-h-0 flex-1 flex-col overflow-hidden px-5 pb-5 pt-5"
      data-testid="twin-blueprint-drafting"
      data-mode={mode}
      data-focus={zoom ?? 'overview'}
      data-reduced={reduced}
      data-working={stage && working}
    >
      {/* Before the drawing on purpose: its handle must be attached when the
          drawing's layout effect hands it the plan (siblings commit in order).
          It paints above the sheet by its own z-index. */}
      <SheetPen
        handle={pen}
        rootRef={rootRef}
        find={find}
        targetKey={target?.key ?? null}
        targetSection={target?.section ?? null}
        working={stage && working}
        busy={stage && (working || shown !== null)}
        active={stage && (reduced || stageDrawn)}
        reduced={reduced}
      />
      <div ref={viewRef} className="relative flex h-full min-h-0 flex-col">
        {stage ? (
          <StageSheet
            model={model}
            reduced={reduced}
            roomy={roomy}
            working={working}
            delta={shown}
            target={target}
            draw={{
              ...draw,
              onDone: () => {
                pen.current?.lift();
                setStageDrawn(true);
              },
            }}
            finish={finish}
            register={register}
            notes={<StageNotes model={model} delta={shown} target={target} reduced={reduced} />}
          />
        ) : zoom === null ? (
          <div key="overview" className="twd-fade-in flex h-full min-h-0 flex-col">
            <OverviewSheet model={model} roomy={roomy} reduced={reduced} draw={{ ...draw, instant: reduced || zoomed }} onFocus={zoomInto} register={register} />
          </div>
        ) : (
          <>
            <SheetBorder draw={false} />
            <FocusSheet
              key={zoom}
              model={model}
              section={zoom}
              reduced={reduced}
              draw={draw}
              origin={origin?.section === zoom ? origin.box : null}
              onBack={() => onFocus(null)}
              onOpenDetail={onOpenDetail}
            />
          </>
        )}
      </div>
      {stage && <LeaderLine rootRef={rootRef} from={leader.from} to={leader.to} playKey={target ? playKey : null} reduced={reduced} />}
    </div>
  );
}
