/**
 * L1 - one milestone as a BRIEF CARD, in the Notepad desk's card language: a
 * large title, a status pill, the brief quoted, the goals as quest lines. The
 * card's own border is the progress gauge (`PerimeterGauge`), so the card is
 * the meter and no bar is drawn beside it.
 */
import { CalendarDays } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { DevGoal } from '@/lib/bindings/DevGoal';

import { goalStatusLabel, goalStatusMeta } from '../../../goalStatus';
import type { MilestoneCard } from '../layerModel';
import { milestoneMeta } from '../milestoneMeta';
import { formatTarget } from '../layerFormat';
import { briefExcerpt, headAndRest } from './cardsModel';
import { CardShell, PerimeterGauge } from './CardShell';

export function MilestoneBriefCard({ card, onOpen }: { card: MilestoneCard; onOpen: () => void }) {
  const { t, tx, language } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const { lane, goals, brief, progress, doneCount } = card;
  const meta = milestoneMeta(dl, lane.status);
  const excerpt = brief ? briefExcerpt(brief.bodyMd) : null;
  const { head, rest } = headAndRest(goals);

  return (
    <CardShell
      onPress={onOpen}
      testId={`layers-cards-milestone-${lane.id}`}
      className="h-full min-h-56 flex flex-col gap-3 px-5 pt-5 pb-4 rounded-card bg-gradient-to-br from-card/80 to-card/40 hover:shadow-elevation-2 hover:-translate-y-px motion-reduce:hover:translate-y-0"
    >
      <PerimeterGauge progress={progress} toneText={meta.tone.text} />

      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block typo-section-title line-clamp-2">{lane.name}</span>
          {lane.objective && (
            <span className="block mt-0.5 typo-body text-foreground line-clamp-1">{lane.objective}</span>
          )}
        </span>
        <span className="shrink-0 flex flex-col items-end gap-1">
          <span
            className={`px-2 py-0.5 rounded-full border typo-label ${meta.tone.bg} ${meta.tone.border} ${meta.tone.text}`}
          >
            {meta.label}
          </span>
          {progress === null ? (
            <span className="typo-caption">{dl.layers_no_goals}</span>
          ) : (
            <Numeric value={progress} unit="percent" precision={0} className={`typo-data-lg ${meta.tone.text}`} />
          )}
        </span>
      </span>

      {excerpt ? (
        <span className="block typo-body text-foreground line-clamp-3">{excerpt}</span>
      ) : (
        <span className="block typo-caption italic">{dl.layers_no_brief}</span>
      )}

      {head.length > 0 && (
        <span className="flex flex-col gap-1">
          {head.map((g) => (
            <GoalLine key={g.id} goal={g} label={goalStatusLabel(dl, g.status)} />
          ))}
          {rest > 0 && (
            <span className="block typo-caption pl-6">+{tx(dl.layers_goal_count, { count: rest })}</span>
          )}
        </span>
      )}

      <span className="mt-auto pt-2 flex items-center justify-between gap-2 border-t border-primary/10">
        <span className="typo-caption tabular-nums">
          {progress === null ? dl.layers_no_goals : tx(dl.layers_goals_done, { done: doneCount, total: goals.length })}
        </span>
        {lane.targetDate && (
          <span className="inline-flex items-center gap-1 typo-caption tabular-nums">
            <CalendarDays className="w-3.5 h-3.5" aria-hidden />
            {tx(dl.layers_target, { date: formatTarget(lane.targetDate, language) ?? lane.targetDate })}
          </span>
        )}
      </span>
    </CardShell>
  );
}

/** A questlog line: the status glyph in the goal's own colour, then the title. */
function GoalLine({ goal, label }: { goal: DevGoal; label: string }) {
  const meta = goalStatusMeta(goal.status);
  const Icon = meta.icon;
  return (
    <span className="flex items-center gap-2 min-w-0">
      <span className={`shrink-0 ${meta.tint}`} aria-label={label} role="img">
        <Icon className="w-4 h-4" />
      </span>
      <span className="typo-body text-foreground truncate">{goal.title}</span>
    </span>
  );
}
