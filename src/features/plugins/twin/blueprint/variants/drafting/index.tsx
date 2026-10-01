/**
 * Blueprint variant "drafting" (spark twin-portable-blueprint, WP7): the twin
 * drawn as a technical drawing on Studio's cyanotype sheet. Four regions laid
 * out like a plan, each an inked drawing of its quantities, with a title
 * block in the corner. Pending parts are dashed, finished ones solid ink,
 * unmeasured ones hatched. L2 zooms one region to fill the sheet; stage mode
 * keeps the middle open for the card and lets the pen ink in where each
 * answer lands. Contract: `BlueprintVariantProps`.
 */
import { useEffect, useRef, useState } from 'react';
import DraftingPen from '@/features/studio/guide/drafting/DraftingPen';
import '@/features/studio/guide/drafting/drafting.css';
import type { BlueprintVariantProps, SectionId } from '../../blueprintContract';
import FocusSheet from './FocusSheet';
import OverviewSheet from './OverviewSheet';
import StageSheet, { STAGE_ORDER } from './StageSheet';
import StageNotes from './StageNotes';
import { deltaTarget } from './draftingTwinModel';
import { useDrawSteps } from './useDrawSteps';
import LeaderLine from './LeaderLine';
import { useLeaderEnds, useMarkRegistry, useSheetPen } from './useSheetPen';
import { useRoomySheet } from './useRoomySheet';
import { insetsWithin, type Insets } from './zoomOrigin';
import './twinDrafting.css';

const DETAIL_ORDER = ['region:identity', 'region:voice', 'region:knowledge', 'region:training', 'title'] as const;
const STAGE_KEYS = STAGE_ORDER.map((k) => (k === 'title' ? 'title' : `region:${k}`));
/** Each part of the sheet is drawn this long after the one before. */
const STEP_MS = { detail: 280, stage: 420, waiting: 900 } as const;

export default function DraftingBlueprint({ model, mode, focus, onFocus, onOpenDetail, delta, working, reduced }: BlueprintVariantProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  /** Where the zoom grows from: the activated region's box inside the sheet, for that section only. */
  const [origin, setOrigin] = useState<{ section: SectionId; box: Insets | null } | null>(null);
  const { register, find } = useMarkRegistry();
  const roomy = useRoomySheet(rootRef);
  const stage = mode === 'stage';
  const zoom: SectionId | null = stage ? null : focus;
  const step = reduced ? 0 : stage ? (working ? STEP_MS.waiting : STEP_MS.stage) : STEP_MS.detail;
  const drawn = useDrawSteps(`${model.twinId}:${mode}`, DETAIL_ORDER.length, step);
  const building = drawn < DETAIL_ORDER.length;
  const target = stage && delta ? deltaTarget(delta, model) : null;

  const penAt = useSheetPen({
    order: stage ? STAGE_KEYS : DETAIL_ORDER,
    drawn,
    building,
    targetKey: target?.key ?? null,
    targetSection: target?.section ?? null,
    working: stage && working,
    active: stage || zoom === null,
    reduced,
    find,
  });

  const leader = useLeaderEnds(target?.key ?? null, drawn, find);
  const playKey = delta ? `${delta.answeredStepId}:${delta.phase}` : null;

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
      {stage ? (
        <StageSheet
          model={model}
          drawn={drawn}
          reduced={reduced}
          roomy={roomy}
          working={working}
          delta={delta}
          target={target}
          register={register}
          notes={<StageNotes model={model} delta={delta} target={target} reduced={reduced} />}
        />
      ) : (
        <div ref={viewRef} className="relative flex h-full min-h-0 flex-col">
          {zoom === null ? (
            <div key="overview" className="twd-fade-in flex h-full min-h-0 flex-col">
              <OverviewSheet model={model} drawn={drawn} reduced={reduced} roomy={roomy} onFocus={zoomInto} register={register} />
            </div>
          ) : (
            <FocusSheet
              key={zoom}
              model={model}
              section={zoom}
              reduced={reduced}
              origin={origin?.section === zoom ? origin.box : null}
              onBack={() => onFocus(null)}
              onOpenDetail={onOpenDetail}
            />
          )}
        </div>
      )}
      {stage && <LeaderLine rootRef={rootRef} from={leader.from} to={leader.to} playKey={playKey} reduced={reduced} />}
      {!reduced && penAt && (
        <div data-testid="twd-pen">
          <DraftingPen rootRef={rootRef} target={penAt} working={building || (stage && (working || delta !== null))} callout={null} />
        </div>
      )}
    </div>
  );
}
