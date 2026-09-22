import { useState } from 'react';
import { Check, Flame, Pencil, Plus, Sparkles, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useDailyGoals } from './useDailyGoals';
import { DailyGoalsModal } from './DailyGoalsModal';

/**
 * Dev-only gamification subheader (rendered behind `devModeAvailable`):
 * streak of consecutive days with all daily goals accomplished, the
 * active set as toggleable chips, and the entry point for the next set.
 * Evaluation is manual — the operator toggles; completing the last goal
 * clears the set (after a short celebratory beat) and grows the streak.
 */
export function DailyGoalsBar() {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const { state, celebrating, createSet, saveEdits, toggle, discard } = useDailyGoals();
  const [modalOpen, setModalOpen] = useState(false);

  if (!state) return null;
  const hasSet = state.goals.length > 0;

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 border-b border-primary/10 bg-primary/[0.03]"
      data-testid="companion-daily-goals"
    >
      <Tooltip content={c.daily_goals_streak_hint}>
        <span className="flex items-center gap-1 typo-caption text-foreground flex-shrink-0">
          <Flame
            className={`w-3 h-3 ${state.streak > 0 ? 'text-amber-400' : ''}`}
            aria-hidden
          />
          <span className="tabular-nums" data-testid="daily-goals-streak">
            {state.streak}
          </span>
        </span>
      </Tooltip>

      {celebrating ? (
        <span
          className="flex items-center gap-1 typo-caption text-amber-400"
          data-testid="daily-goals-celebration"
        >
          <Sparkles className="w-3 h-3" aria-hidden />
          {c.daily_goals_completed_celebrate}
        </span>
      ) : hasSet ? (
        <div className="flex items-center gap-1 min-w-0 overflow-x-auto">
          {state.goals.map((g) => (
            // The chip stays one line, so the tooltip carries the full
            // text for a glance and the edit modal for a proper read.
            <Tooltip key={g.id} content={g.title}>
              <button
                type="button"
                onClick={() => void toggle(g.id, !g.done)}
                aria-pressed={g.done}
                aria-label={`${g.title} - ${
                  g.done ? c.daily_goals_mark_open : c.daily_goals_mark_done
                }`}
                data-testid={`daily-goal-chip-${g.slot}`}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded-interactive typo-caption transition-colors focus-ring max-w-48 ${
                  g.done
                    ? 'bg-primary/15 text-primary line-through'
                    : 'text-foreground hover:bg-secondary/40'
                }`}
              >
                {g.done && <Check className="w-3 h-3 flex-shrink-0" aria-hidden />}
                <span className="truncate">{g.title}</span>
              </button>
            </Tooltip>
          ))}
        </div>
      ) : (
        <span className="typo-caption text-foreground">
          {state.completedToday ? c.daily_goals_done_today : c.daily_goals_label}
        </span>
      )}

      <div className="flex-1" />

      {hasSet && !celebrating && (
        <Tooltip content={c.daily_goals_edit}>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            data-testid="daily-goals-edit"
            className="p-1 rounded-interactive text-foreground hover:bg-secondary/40 transition-colors focus-ring"
            aria-label={c.daily_goals_edit}
          >
            <Pencil className="w-3 h-3" />
          </button>
        </Tooltip>
      )}
      {hasSet && !celebrating && (
        <button
          type="button"
          onClick={() => void discard()}
          data-testid="daily-goals-discard"
          className="p-1 rounded-interactive text-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors focus-ring"
          aria-label={c.daily_goals_discard}
          title={c.daily_goals_discard}
        >
          <X className="w-3 h-3" />
        </button>
      )}
      {!hasSet && !celebrating && (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          data-testid="daily-goals-open-modal"
          className="flex items-center gap-1 px-1.5 py-0.5 rounded-interactive typo-caption text-foreground hover:bg-secondary/40 transition-colors focus-ring"
        >
          <Plus className="w-3 h-3" aria-hidden />
          {c.daily_goals_set_button}
        </button>
      )}

      <DailyGoalsModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        goals={state.goals}
        onCreate={createSet}
        onSave={saveEdits}
      />
    </div>
  );
}
