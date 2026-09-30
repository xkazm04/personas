import { useTranslation } from '@/i18n/useTranslation';
import { Rows, Section, UnitStrip } from '@/features/shared/components/kit';
import { POWER_MOVES, POWER_MOVE_GROUPS } from './registry';
import { usePowerMovesStore, usePowerMoveDetection } from './powerMovesStore';
import { PowerMoveRow } from './PowerMoveRow';
import { isPowerMoveReachable } from './reachable';
import { useTier } from '@/hooks/utility/interaction/useTier';

/**
 * The Learning hub's quest board: power moves grouped by payoff, each row a
 * deep-linking "Try it" launcher. Progress counts moves actually used,
 * detected from real data where a move has a probe, otherwise tried; the
 * Section draws it as one unit per move.
 */
export function PowerMovesPanel() {
  const { t, tx } = useTranslation();
  const ht = t.home.learning;
  usePowerMoveDetection();
  const tried = usePowerMovesStore((s) => s.tried);
  const done = usePowerMovesStore((s) => s.done);
  const tier = useTier();
  // Never offer a move whose destination tab this build hides: the router has
  // no tier/dev check, so the row would land the user on an orphaned surface.
  const moves = POWER_MOVES.filter((m) => isPowerMoveReachable(m, tier.current));
  const usedCount = moves.filter((m) => done[m.id] || tried[m.id]).length;
  const label = tx(ht.moves_used, { used: usedCount, total: moves.length });

  return (
    <Section
      title={ht.power_moves}
      count={<span data-testid="power-moves-progress">{label}</span>}
      meta={
        <UnitStrip
          size="m"
          label={label}
          segments={[
            { n: usedCount, tone: 'success', glyph: 'solid' },
            { n: moves.length - usedCount, tone: 'neutral', glyph: 'empty' },
          ]}
        />
      }
    >
      {POWER_MOVE_GROUPS.map((group) => {
        const groupMoves = moves.filter((move) => move.group === group.key);
        // A group whose every move is gated out of this build would otherwise
        // render as a bare heading over nothing.
        if (groupMoves.length === 0) return null;
        return (
          <Section key={group.key} level={2} title={ht[group.labelKey]}>
            <Rows count={groupMoves.length} empty={{ title: '' }}>
              {groupMoves.map((move) => <PowerMoveRow key={move.id} move={move} />)}
            </Rows>
          </Section>
        );
      })}
    </Section>
  );
}
