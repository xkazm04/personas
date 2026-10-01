/**
 * L2 Knowledge: the tri-arc unfolded into a full ring (approved solid,
 * awaiting review hatched, rejected outlined, as shares of every memory), the
 * fact ticks around it (one per fact up to the declared strip, chevrons past
 * it), and the knowledge-base ring at the hub: solid when one is bound,
 * dashed when not. The panel carries the counts; L3 opens from the header.
 */
import { useTranslation } from '@/i18n/useTranslation';

import type { TwinBlueprintModel } from '../../../blueprintContract';
import { CompositionArc, TickRing, type RadialIds } from '../glyphs/primitives';
import { FACT_TICKS_DETAIL, memoryParts } from '../radialModel';
import { FocusBody, FocusFigure } from './FocusBody';
import { LegendKey, PanelGroup } from './PanelParts';

interface KnowledgeFocusProps {
  model: TwinBlueprintModel;
  ids: RadialIds;
  panelW: number;
  reduced: boolean;
  onOpen: (itemKey?: string) => void;
}

export function KnowledgeFocus({ model, ids, panelW, reduced, onOpen }: KnowledgeFocusProps) {
  const { t } = useTranslation();
  const tb = t.twin.blueprint;
  const { memories, facts, kbBound } = model.knowledge;
  const parts = memoryParts(memories);

  return (
    <FocusBody
      panelW={panelW}
      reduced={reduced}
      figure={(geo) => (
        <FocusFigure geo={geo} ids={ids} hub={{ value: parts ? parts.total : null, label: tb.metrics.memories }} guides={[0.31, 0.6, 0.7, 1]}>
          <g className="rd-pick" onClick={() => onOpen()}>
            <circle
              className={kbBound ? 'rd-kb is-bound' : 'rd-kb'}
              data-testid="radial-kb"
              data-bound={kbBound ? 'true' : 'false'}
              cx={geo.cx}
              cy={geo.cy}
              r={geo.R * 0.27}
            />
            <CompositionArc
              band={{ cx: geo.cx, cy: geo.cy, r0: geo.R * 0.31, r1: geo.R * 0.6, a0: 0, a1: 360 }}
              parts={parts}
              ids={ids}
              testId="radial-memories"
            />
            <TickRing
              band={{ cx: geo.cx, cy: geo.cy, r0: geo.R * 0.7, r1: geo.R, a0: 0, a1: 354 }}
              count={facts}
              slots={FACT_TICKS_DETAIL}
              ids={ids}
              testId="radial-facts"
            />
          </g>
        </FocusFigure>
      )}
      panel={
        <>
          <PanelGroup title={tb.metrics.memories} testId="radial-memory-keys">
            <div className="rd-legend is-column">
              <LegendKey kind="fill" ids={ids} label={tb.metrics.approved} value={memories.approved} testId="radial-key-approved" />
              <LegendKey kind="await" ids={ids} label={tb.metrics.awaiting} value={memories.pending} testId="radial-key-pending" />
              <LegendKey kind="reject" ids={ids} label={tb.metrics.rejected} value={memories.rejected} testId="radial-key-rejected" />
            </div>
          </PanelGroup>
          <PanelGroup title={tb.metrics.facts}>
            <div className="rd-legend is-column">
              <LegendKey kind="tick" ids={ids} label={tb.metrics.facts} value={facts} testId="radial-key-facts" />
            </div>
          </PanelGroup>
          <PanelGroup title={tb.metrics.knowledgeBase}>
            <div className="rd-legend is-column">
              <LegendKey kind={kbBound ? 'fill' : 'reject'} ids={ids} label={kbBound ? tb.metrics.kbBound : tb.metrics.kbUnbound} />
            </div>
          </PanelGroup>
          <div className="rd-legend">
            <LegendKey kind="hatch" ids={ids} label={tb.states.notMeasured} />
          </div>
        </>
      }
    />
  );
}
