/**
 * The plan's goals at L2, one row each across the panel's full width: the
 * planner's title verbatim, a coverage meter on 0..1 with its share, and the
 * answers credited to it. A dropped goal stays visible, dashed, its share "-".
 * No plan yet: the hatched "no training yet" band.
 */
import { TruncateWithTooltip } from '@/features/shared/components/display/TruncateWithTooltip';
import { useTranslation } from '@/i18n/useTranslation';

import type { TwinBlueprintModel } from '../../../blueprintContract';
import { StrataFigure } from '../StrataFigure';
import { PressRow, StrataMeter } from './StrataMeter';

export function GoalRows({ model, onOpen }: { model: TwinBlueprintModel; onOpen: (key?: string) => void }) {
  const { t } = useTranslation();
  const tm = t.twin.blueprint.metrics;
  const goals = model.training.goals;

  if (goals.length === 0) {
    return (
      <div className="flex flex-col gap-2" data-measured="false">
        <span className="typo-label text-primary">{tm.goals}</span>
        <span className="strata-meter strata-meter--lg is-unmeasured" aria-hidden />
        <span className="typo-body text-foreground">{t.twin.blueprint.states.emptyTraining}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col" role="list">
      <div className="strata-goal-row strata-goal-head" aria-hidden>
        <span className="typo-label text-primary">{tm.goals}</span>
        <span className="typo-label">{tm.coverage}</span>
        <span />
        <span className="typo-label">{tm.answers}</span>
      </div>
      {goals.map((g) => {
        const dropped = g.state === 'dropped';
        return (
          <div role="listitem" key={g.id}>
            <PressRow label={g.title} onPress={() => onOpen(g.id)} className="strata-goal-row" testId={`strata-goal-${g.id}`}>
              <TruncateWithTooltip text={g.title} className="typo-body text-foreground" />
              <span data-state={g.state}>
                <StrataMeter value={dropped ? 0 : g.coverage} fullAt={1} dashed={dropped} />
              </span>
              <StrataFigure value={dropped ? null : g.coverage} unit="ratio" className="typo-data text-foreground" />
              <StrataFigure value={g.answered} className="typo-data text-foreground" />
            </PressRow>
          </div>
        );
      })}
    </div>
  );
}
