/**
 * R5 · B — "Instrument on a time axis". Athena's chat as an engineered
 * instrument panel: a slim TIME SPINE on the right edge (every run thread a
 * hairline lane on the last hour, gates as notched tabs that break its edge),
 * a precise COMMAND LINE at the bottom that rises into the transcript, and
 * gates that open as CONTROL SURFACES with physical keys. Mono numerals,
 * hairlines, calm luminance.
 *
 * Views come from the product's `useLayer` (Alt+W toggles the work layer, Esc
 * folds): `work` with no focus is the spine pulled wide into the timeline
 * board; `work` with a focus is that item's control surface, the spine slim
 * again beside it with a leader to the gate. Same props as `FilamentFrame`.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { BrainViewer } from '../../../../../BrainViewer';
import { useAthenaStore } from '../../../../../athenaStore';
import type { AthenaChatEngine } from '../../../../athenaChatEngine';
import { ReportReader } from '../../../../refs/ReportReader';
import { RefOpenerProvider } from '../../../../refs/RefOpenerContext';
import { useLayer } from '../../../useLayer';
import { useLayerRefOpener } from '../../../useLayerRefOpener';
import { useWorkforce } from '../../../useWorkforce';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { useSystemStore } from '@/stores/systemStore';
import { CommandLine } from './CommandLine';
import { ControlSurface } from './ControlSurface';
import { R5B_COPY as C } from './copy';
import { Leader } from './Leader';
import { phaseOf } from './PhaseReadout';
import { EDGE, geometry } from './spineGeometry';
import { TimeSpine } from './TimeSpine';
import type { Flight } from './TurnRow';
import { useTimeModel, type Lane, type Mark } from './timeModel';
import { useInstrumentKeys, useLayerBox } from './useInstrument';
import './r5b.css';

/** A surface's floor: clear of the command line even with its readout row up. */
const SURFACE_BOTTOM = 112;

export function R5BFrame({ engine, lifted }: { engine: AthenaChatEngine; lifted: boolean }) {
  const workforce = useWorkforce();
  const layer = useLayer();
  const { view } = layer;
  const refOpener = useLayerRefOpener(layer, workforce.items);
  const { shouldAnimate } = useMotion();
  const streaming = useAthenaStore((s) => s.streaming);
  const streamingPhase = useAthenaStore((s) => s.streamingPhase);
  const brainOpen = useAthenaStore((s) => s.brainView.open);
  const model = useTimeModel(workforce, engine.messages, streaming);
  const layerRef = useRef<HTMLDivElement>(null);
  const box = useLayerBox(layerRef);
  const flight = useRef<Flight | null>(null);
  const inputRoot = useRef<HTMLDivElement | null>(null);
  const [engagedRaw, setEngaged] = useState(false);

  const focusId = view.kind === 'work' ? view.focus : null;
  const item = useMemo(() => (focusId ? (workforce.items.find((i) => i.id === focusId) ?? null) : null), [focusId, workforce.items]);
  const surfaceOpen = view.kind === 'work' && focusId !== null;
  const boardOpen = view.kind === 'work' && !surfaceOpen && !brainOpen;
  const centreOpen = brainOpen || view.kind === 'report';
  const engaged = engagedRaw && view.kind === 'chat' && !brainOpen;

  const geom = useMemo(() => geometry(boardOpen ? 'board' : 'slim', model.lanes, box), [boardOpen, model.lanes, box]);
  const phase = phaseOf(streaming, streamingPhase);
  const where = useMemo(() => {
    const lane = model.lanes.find((l) => l.marks.some((m) => m.id === focusId));
    return !lane || lane.project === null ? C.athena : `${lane.project} · ${lane.name}`;
  }, [model.lanes, focusId]);

  const slimW = geometry('slim', model.lanes, box).width;
  const side = slimW + EDGE.right + 32;
  const consoleSize = {
    rest: Math.round(Math.min(540, Math.max(440, box.width * 0.32))),
    open: Math.round(Math.min(880, box.width - 2 * side)),
    height: Math.max(240, box.height - 92),
  };

  const onEngage = useCallback(
    // A board, a surface, a report or the Brain holds the stage: typing there
    // (a question about the open gate, say) does not raise the transcript over it.
    (_why: 'focus' | 'send') => {
      if (view.kind !== 'chat' || brainOpen) return false;
      setEngaged(true);
      return true;
    },
    [view.kind, brainOpen],
  );
  const toggleTranscript = useCallback(() => {
    if (view.kind !== 'chat') layer.back();
    setEngaged((e) => !(e && view.kind === 'chat'));
  }, [view.kind, layer]);
  const openGate = useCallback(
    (mark: Mark, lane: Lane) => {
      if (mark.itemId) layer.openWork(mark.itemId, null);
      else if (lane.sessionId) {
        const sys = useSystemStore.getState();
        sys.fleetSetActiveSession(lane.sessionId);
        sys.fleetSetGridOpen(true);
      }
    },
    [layer],
  );

  useInstrumentKeys({ engaged, inputRoot, onToggleTranscript: toggleTranscript, onFold: () => setEngaged(false) });

  return (
    <RefOpenerProvider value={refOpener}>
      <div
        ref={layerRef}
        className={`r5b fixed inset-x-0 bottom-0 top-[112px] ${lifted ? 'z-[220]' : 'z-[120]'} pointer-events-none`}
        data-testid="companion-panel"
        data-chat-variant="r5b"
      >
        {centreOpen && (
          <div className="absolute inset-x-0 top-4 flex justify-center pointer-events-none" style={{ bottom: SURFACE_BOTTOM }}>
            <div className="r5b-console rounded-modal shadow-elevation-4 pointer-events-auto max-h-full overflow-hidden flex flex-col" style={{ width: consoleSize.open }}>
              {brainOpen ? (
                <BrainViewer onClose={() => useAthenaStore.getState().setBrainView({ open: false, kind: null, id: null })} />
              ) : view.kind === 'report' ? (
                <ReportReader reportId={view.id} onClose={layer.back} overlay={false} escToClose={false} />
              ) : null}
            </div>
          </div>
        )}

        {surfaceOpen && item && !brainOpen && (
          <>
            <div className="absolute inset-x-0 top-4 flex items-center justify-center pointer-events-none" style={{ bottom: SURFACE_BOTTOM }}>
              <ControlSurface
                items={workforce.items}
                item={item}
                where={where}
                width={Math.min(760, box.width - 2 * side)}
                animate={shouldAnimate}
                onFocus={(id) => layer.openWork(id, null)}
                onFold={() => layer.openWork(null, null)}
                onSend={engine.send}
              />
            </div>
            <Leader gateId={item.id} revision={`${item.id}-${box.width}-${box.height}`} />
          </>
        )}

        <TimeSpine
          model={model}
          geom={geom}
          focusId={surfaceOpen ? focusId : null}
          live={streaming && shouldAnimate}
          athenaWord={phase.tool ? `${phase.word} · ${phase.tool}` : phase.word}
          onToggle={layer.toggleWork}
          onOpenGate={openGate}
        />

        <div className="absolute inset-x-0 bottom-3 flex justify-center pointer-events-none">
          <CommandLine
            engine={engine}
            engaged={engaged}
            size={consoleSize}
            animate={shouldAnimate}
            about={surfaceOpen ? item : null}
            flight={flight}
            inputRoot={inputRoot}
            onEngage={onEngage}
            onToggle={toggleTranscript}
          />
        </div>
      </div>
    </RefOpenerProvider>
  );
}

export default R5BFrame;
