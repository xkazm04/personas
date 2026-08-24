// The composer's left rail: the project's GOALS, and nothing else.
//
// This replaced a browsable project library — group bands → contexts →
// features → per-context quick-add — on the operator's ruling of 2026-08-24:
// composing a milestone must not require him to browse a tree and work out
// which context or use case an idea belongs to. That mapping is the LLM layer's
// job (`buildGoalAssistPrompt` already asks an agent to assign contexts, do the
// work, and flag the result for review), and asking a person to do it by hand
// was asking them to think in the schema's vocabulary instead of their own.
//
// A goal is the artifact the operator actually thinks in — an intention, not a
// slice of the codebase — so a goal is the only thing this rail lists, and
// "write a new one" is its primary action. Features still reach the cut, but
// through the planner's own "outside the cut" ledger or through Athena, neither
// of which requires navigating a hierarchy.
//
// Deliberately absent, and each one is a decision rather than an oversight:
//   · the context tree and the feature rows (the ruling above);
//   · the per-context quick-add (it minted a use case against a context the
//     operator had to pick, which is the same demand wearing a smaller hat);
//   · the "what this library is" paragraph (this rail is one list and one
//     button — a sentence explaining that is chrome, not help);
//   · the uncharted/scan empty state (it existed because the tree needed
//     contexts; a goal needs none, so an unscanned project can still be given
//     objectives).
import { useMemo, useState } from 'react';
import { Plus, Search, Target, Zap } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

import { INK } from '../../passport/passportInk';
import type { ShipGoal, ShipMilestoneVM } from './shipModel';
import type { ShipData } from './useShipData';

/** Below this the filter is noise — a rail you can read in one glance does not
 *  need a search box above it. */
const FILTER_FROM = 7;

export function ShipGoalRail({ ship, vm, onNewGoal, onAssistGoal }: {
  ship: ShipData;
  vm: ShipMilestoneVM;
  onNewGoal: () => void;
  /** Hand the goal to an agent — it assigns contexts and does the work. */
  onAssistGoal: (g: ShipGoal) => void;
}) {
  const { t, tx } = useTranslation();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const boundIds = useMemo(
    () => new Set(vm.boundGoals.map((g) => g.id)),
    [vm.boundGoals],
  );

  // Unbound first: the rail's job is to offer what this milestone could still
  // take on, and a goal already in the cut is answered. Stable alphabetical
  // inside each half so the list does not reshuffle as goals are bound.
  const goals = useMemo(() => {
    const matched = q
      ? ship.goals.filter((g) => g.name.toLowerCase().includes(q))
      : ship.goals;
    return [...matched].sort((a, b) => {
      const ab = boundIds.has(a.id), bb = boundIds.has(b.id);
      if (ab !== bb) return ab ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  }, [ship.goals, q, boundIds]);

  return (
    <>
      <div className="flex items-center gap-2 mb-2">
        <h3 className="typo-title min-w-0">{t.ship.goals_rail_title}</h3>
        <span className="typo-data text-foreground/40">{ship.goals.length}</span>
        <button
          type="button"
          onClick={onNewGoal}
          className="ml-auto shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-interactive typo-caption font-medium border transition-colors hover:bg-foreground/[0.05] focus-ring"
          style={{ color: INK.teal, borderColor: `${INK.teal}55` }}
          data-testid="ship-new-goal"
        >
          <Target className="w-3 h-3" aria-hidden />
          {t.ship.new_goal}
        </button>
      </div>

      {ship.goals.length >= FILTER_FROM && (
        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.ship.filter_placeholder}
            className={`${INPUT_FIELD} !py-1 !pl-8 !text-sm`}
            aria-label={t.ship.filter_aria}
            data-testid="ship-lib-search"
          />
        </div>
      )}

      <ul className="grid gap-1" data-testid="ship-goal-rail">
        {goals.map((g) => {
          const bound = boundIds.has(g.id);
          return (
            <li
              key={g.id}
              className={`flex items-center gap-2 rounded-card px-2 py-1.5 min-w-0 ${bound ? 'opacity-45' : ''}`}
              style={{ background: 'rgba(148,163,184,.04)' }}
            >
              <Target className="w-3 h-3 shrink-0" style={{ color: INK.teal }} aria-hidden />
              <span className="typo-caption text-foreground min-w-0 truncate">{g.name}</span>
              <span className="ml-auto inline-flex items-center gap-1 shrink-0">
                <Tooltip content={t.ship.goal_assist_tooltip}>
                  <button
                    type="button"
                    onClick={() => onAssistGoal(g)}
                    className="p-0.5 rounded-interactive transition-colors hover:bg-foreground/[0.08] focus-ring"
                    aria-label={tx(t.ship.goal_assist_aria, { name: g.name })}
                  >
                    <Zap className="w-3 h-3" style={{ color: INK.violet }} aria-hidden />
                  </button>
                </Tooltip>
                {bound ? (
                  <span className="typo-caption shrink-0">{t.ship.bound}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => ship.setItem(vm.id, 'goal', g.id, 'core')}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-interactive typo-caption border transition-colors hover:bg-foreground/[0.05] focus-ring shrink-0"
                    style={{ color: INK.teal, borderColor: `${INK.teal}55` }}
                    aria-label={tx(t.ship.bind_aria, { name: g.name })}
                  >
                    <Plus className="w-3 h-3" aria-hidden />{t.ship.bind}
                  </button>
                )}
              </span>
            </li>
          );
        })}

        {goals.length === 0 && (
          <li
            className="rounded-card border border-dashed px-3 py-4 typo-caption text-center"
            style={{ borderColor: `${INK.blue}55`, color: INK.blue }}
            data-testid="ship-goal-rail-empty"
          >
            {q ? tx(t.ship.no_matches, { query: query.trim() }) : t.ship.goals_rail_empty}
          </li>
        )}
      </ul>
    </>
  );
}
