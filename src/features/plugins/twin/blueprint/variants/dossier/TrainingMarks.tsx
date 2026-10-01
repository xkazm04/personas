/**
 * Dossier (WP9): the plan's goals and the answer kinds as drawn quantities.
 * - `GoalColumns`: one column per goal on the declared 0..1 coverage domain;
 *   a dropped goal is a dashed outline, never a short bar.
 * - `GoalMeter`: one goal as a horizontal 0..1 bar; on the stage, the share the
 *   last answer added (`coverageGain`) grows in as its own segment.
 * - `KindStrip`: answered steps by kind as apportioned kit units.
 */
import type { CSSProperties } from 'react';
import { motion } from 'framer-motion';

import { UnitStrip, apportion, quantumFor } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { formatNumeric } from '@/lib/utils/formatters';

import type { BlueprintGoal, StepKind } from '../../blueprintContract';
import { KIND_TONE, clamp01, kindParts } from './dossierModel';
import { NotMeasured } from './Figure';

const GAIN_GROW = { duration: 0.9, ease: [0.22, 1, 0.36, 1] } as const;

function useGoalAria(): (goal: BlueprintGoal) => string {
  const { t, tx, language } = useTranslation();
  return (goal) =>
    tx(t.twin.blueprint.variantCopy.dossier.goalAria, {
      title: goal.title,
      pct: formatNumeric(clamp01(goal.coverage), 'ratio', { precision: 0, language }),
    });
}

export function GoalColumns({ goals, hotGoal }: { goals: readonly BlueprintGoal[]; hotGoal?: string | null }) {
  const { t, tx } = useTranslation();
  const aria = useGoalAria();
  if (goals.length === 0) {
    return <NotMeasured width="var(--dz-goals-w)" height="var(--dz-goals-h)" testId="dossier-goals-none" />;
  }
  return (
    <span
      className="dossier-goals"
      role="group"
      aria-label={tx(t.twin.blueprint.variantCopy.dossier.goalsAria, { count: goals.length })}
      data-testid="dossier-goals"
    >
      {goals.map((g) => (
        <span
          key={g.id}
          className="dossier-goal"
          role="img"
          aria-label={aria(g)}
          data-dropped={g.state === 'dropped' ? 'true' : undefined}
          data-hot={hotGoal === g.id ? 'true' : undefined}
          style={{ '--c': clamp01(g.coverage) } as CSSProperties}
        />
      ))}
    </span>
  );
}

interface GoalMeterProps {
  goal: BlueprintGoal;
  /** The share the last answer added (stage, reconciled phase); `null` = none drawn. */
  gain?: number | null;
  /** Replays the growth when a new delta arrives. */
  gainKey?: string;
  reduced: boolean;
}

export function GoalMeter({ goal, gain = null, gainKey, reduced }: GoalMeterProps) {
  const aria = useGoalAria();
  const cover = clamp01(goal.coverage);
  const added = gain === null ? 0 : Math.min(cover, clamp01(gain));
  const style = { '--c': cover - added, '--g': added } as CSSProperties;
  return (
    <span
      className="dossier-meter"
      role="img"
      aria-label={aria(goal)}
      data-dropped={goal.state === 'dropped' ? 'true' : undefined}
      data-testid={`dossier-goal-meter-${goal.id}`}
      style={style}
    >
      <span className="dossier-meter__base" />
      {added > 0 &&
        (reduced ? (
          <span className="dossier-meter__gain" data-testid="dossier-gain" />
        ) : (
          <motion.span
            key={gainKey}
            className="dossier-meter__gain"
            data-testid="dossier-gain"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={GAIN_GROW}
          />
        ))}
    </span>
  );
}

interface KindStripProps {
  kindMix: Partial<Record<StepKind, number>>;
  hotKind?: StepKind | null;
  /** Units per row before the quantum grows. */
  maxUnits?: number;
}

export function KindStrip({ kindMix, hotKind, maxUnits = 30 }: KindStripProps) {
  const { t, tx } = useTranslation();
  const copy = t.twin.blueprint.variantCopy.dossier;
  const parts = kindParts(kindMix);
  const total = parts.reduce((s, p) => s + p.n, 0);
  const quantum = quantumFor(total, maxUnits);
  const segments = apportion(
    parts.map((p) => ({ value: p.n, tone: KIND_TONE[p.kind], glyph: hotKind && hotKind !== p.kind ? ('soft' as const) : undefined })),
    quantum,
  );
  return (
    <span className="dossier-kinds" data-testid="dossier-kinds">
      <UnitStrip
        size="m"
        segments={segments}
        label={tx(copy.kindsAria, { count: total })}
        legend={quantum > 1 ? tx(copy.answerUnit, { count: quantum }) : undefined}
      />
    </span>
  );
}
