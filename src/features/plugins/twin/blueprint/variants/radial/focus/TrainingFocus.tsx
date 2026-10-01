/**
 * L2 Training: the quadrant unfolded into a full ring. Inner cells: the plan's
 * goals, each filled to its coverage (a dropped goal dashed, no plan yet
 * hatched). Outer cells: the six topics, approved answers solid and awaiting
 * review hatched after them on the declared 0..5 domain. The panel names every
 * topic and goal and opens each in L3.
 */
import { useState } from 'react';

import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import { formatNumeric } from '@/lib/utils/formatters';

import type { TwinBlueprintModel } from '../../../blueprintContract';
import { TRAINING_TOPIC_PRESETS } from '../../../../sub_training/topicPresets';
import { CellRing } from '../glyphs/CellRing';
import { Unmeasured, type RadialIds } from '../glyphs/primitives';
import { topicCells } from '../glyphs/SectionGlyph';
import { RadialFigure } from '../RadialFigure';
import { TOPIC_FULL_AT } from '../radialModel';
import { FocusBody, FocusFigure } from './FocusBody';
import { ItemRow, LegendKey, PanelGroup, StatLine, SwatchHead, joinLabel } from './PanelParts';

interface TrainingFocusProps {
  model: TwinBlueprintModel;
  ids: RadialIds;
  panelW: number;
  reduced: boolean;
  onOpen: (itemKey?: string) => void;
}

export function TrainingFocus({ model, ids, panelW, reduced, onOpen }: TrainingFocusProps) {
  const { t, tx, language } = useTranslation();
  const tb = t.twin.blueprint;
  const rc = tb.variantCopy.radial;
  const [hot, setHot] = useState<string | null>(null);
  const { goals, topics } = model.training;
  const topicName = (id: string) => {
    const preset = TRAINING_TOPIC_PRESETS.find((p) => p.id === id);
    return preset ? t.twin.training[preset.labelKey] : id;
  };

  return (
    <FocusBody
      panelW={panelW}
      reduced={reduced}
      figure={(geo) => {
        const goalBand = { cx: geo.cx, cy: geo.cy, r0: geo.R * 0.29, r1: geo.R * 0.46, a0: 0, a1: 360 };
        return (
          <FocusFigure geo={geo} ids={ids} hub={{ value: model.training.answered, label: tb.metrics.answers }} guides={[0.29, 0.46, 0.52, 1]}>
            {goals.length === 0 ? (
              <Unmeasured band={goalBand} ids={ids} testId="radial-goals" />
            ) : (
              <CellRing
                band={goalBand}
                cells={goals.map((g) => ({ key: g.id, solid: g.coverage, dashed: g.state === 'dropped' }))}
                ids={ids}
                hot={hot}
                onHot={setHot}
                onPick={onOpen}
                testId="radial-goals"
              />
            )}
            <CellRing
              band={{ cx: geo.cx, cy: geo.cy, r0: geo.R * 0.52, r1: geo.R, a0: 0, a1: 360 }}
              cells={topicCells(model)}
              ids={ids}
              gapPx={8}
              hot={hot}
              onHot={setHot}
              onPick={onOpen}
              testId="radial-topics"
            />
          </FocusFigure>
        );
      }}
      panel={
        <>
          <div className="rd-legend">
            <LegendKey kind="fill" ids={ids} label={tb.metrics.approved} />
            <LegendKey kind="await" ids={ids} label={tb.metrics.awaiting} />
            {rc.dropped && <LegendKey kind="reject" ids={ids} label={rc.dropped} />}
            <LegendKey kind="hatch" ids={ids} label={tb.states.notDrawn} />
          </div>
          <div className="rd-panel-group">
            <StatLine label={tb.metrics.observations} value={model.training.observations} />
            <div className="rd-stat-line">
              <span className="typo-caption">{tb.metrics.lastTrained}</span>
              {model.training.lastTrainedAt ? (
                <RelativeTime timestamp={model.training.lastTrainedAt} className="typo-data text-foreground" />
              ) : (
                <span className="typo-data text-foreground">{tb.metrics.neverTrained}</span>
              )}
            </div>
          </div>
          <PanelGroup
            title={joinLabel(tb.metrics.topics, tx(rc.coveredAt, { count: TOPIC_FULL_AT }))}
            columns={[
              <SwatchHead key="a" kind="fill" ids={ids} label={tb.metrics.approved} />,
              <SwatchHead key="w" kind="await" ids={ids} label={tb.metrics.awaiting} />,
            ]}
            testId="radial-topic-rows"
          >
            {topics.map((topic) => (
              <ItemRow
                key={topic.id}
                label={joinLabel(
                  topicName(topic.id),
                  tb.tiers[topic.tier],
                  `${tb.metrics.approved} ${topic.approved}`,
                  `${tb.metrics.awaiting} ${topic.awaiting}`,
                )}
                hot={hot === topic.id}
                onHot={(on) => setHot(on ? topic.id : null)}
                onPress={() => onOpen(topic.id)}
                testId={`radial-topic-${topic.id}`}
              >
                <span className="rd-row-main">
                  <span className="typo-body text-foreground">{topicName(topic.id)}</span>
                </span>
                <RadialFigure value={topic.approved} className="rd-col typo-data text-foreground" />
                <RadialFigure value={topic.awaiting} className="rd-col typo-data text-primary" />
              </ItemRow>
            ))}
          </PanelGroup>
          <PanelGroup title={tb.metrics.goals} columns={[tb.metrics.coverage]} testId="radial-goal-rows">
            {goals.length === 0 && <p className="typo-caption">{tb.states.emptyTraining}</p>}
            {goals.map((g) => (
              <ItemRow
                key={g.id}
                label={joinLabel(g.title, `${tb.metrics.coverage} ${formatNumeric(g.coverage, 'ratio', { precision: 0, language })}`)}
                hot={hot === g.id}
                onHot={(on) => setHot(on ? g.id : null)}
                onPress={() => onOpen(g.id)}
                testId={`radial-goal-${g.id}`}
              >
                <span className="rd-row-main">
                  <span className="typo-body text-foreground">{g.title}</span>
                  {g.state === 'dropped' && rc.dropped && <span className="typo-caption">{rc.dropped}</span>}
                </span>
                <RadialFigure value={g.coverage} unit="ratio" className="rd-col typo-data text-foreground" />
              </ItemRow>
            ))}
          </PanelGroup>
        </>
      }
    />
  );
}
