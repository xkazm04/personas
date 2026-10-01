/**
 * Stage: the anatomy as the training overlay's base layer. It sits in the
 * rail left of the centred question card at lower contrast (behind the card,
 * fainter still, when the rail is too narrow), the answered segment lit and
 * the other three receded; the delta plays on that segment and the words sit
 * under the ring. `working` sends a slow tick orbiting the ring.
 */
import type { SectionId, BlueprintDelta, TwinBlueprintModel } from '../../blueprintContract';
import type { RadialIds } from './glyphs/primitives';
import { stageLayout } from './radialLayout';
import { deltaTarget } from './radialModel';
import { RingFigure } from './RingFigure';
import { OrbitTick, StageDelta } from './StageDelta';
import { StageReadout } from './StageReadout';

interface RadialStageProps {
  model: TwinBlueprintModel;
  coverage: Record<SectionId, number | null>;
  w: number;
  h: number;
  ids: RadialIds;
  delta: BlueprintDelta | null;
  working: boolean;
  reduced: boolean;
}

export function RadialStage({ model, coverage, w, h, ids, delta, working, reduced }: RadialStageProps) {
  const layout = stageLayout(w, h);
  const { cx, cy, R } = layout;
  const target = delta ? deltaTarget(delta, model) : null;
  const lead = target?.section ?? null;

  return (
    <div
      className="rd-stage"
      data-testid="radial-stage"
      data-behind={layout.behind ? 'true' : undefined}
      data-compact={layout.compact ? 'true' : undefined}
      data-lead={lead ?? undefined}
    >
      <RingFigure
        model={model}
        coverage={coverage}
        w={w}
        h={h}
        cx={cx}
        cy={cy}
        R={R}
        ids={ids}
        labels={null}
        hot={lead}
        lead={lead}
        litTopic={target?.topicId ?? null}
        litChannel={delta?.channel ?? null}
      >
        {delta && target && (
          <StageDelta delta={delta} target={target} sectionCoverage={coverage[target.section]} cx={cx} cy={cy} R={R} reduced={reduced} />
        )}
        {working && !reduced && <OrbitTick cx={cx} cy={cy} R={R} />}
      </RingFigure>
      <StageReadout
        model={model}
        delta={delta}
        target={target}
        working={working}
        reduced={reduced}
        style={{ left: layout.readout.left, top: layout.readout.top, width: layout.readout.width }}
      />
    </div>
  );
}
