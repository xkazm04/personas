import { Sparkles } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { POWER_MOVES, POWER_MOVE_GROUPS } from './registry';
import { usePowerMovesStore, usePowerMoveDetection } from './powerMovesStore';
import { PowerMoveRow } from './PowerMoveRow';

/**
 * The Learning hub's quest board: power moves grouped by payoff, each row a
 * deep-linking "Try it" launcher. Progress counts moves actually used —
 * detected from real data where a move has a probe, otherwise tried.
 */
export function PowerMovesPanel() {
  const { t, tx } = useTranslation();
  const ht = t.home.learning;
  usePowerMoveDetection();
  const tried = usePowerMovesStore((s) => s.tried);
  const done = usePowerMovesStore((s) => s.done);
  const usedCount = POWER_MOVES.filter((m) => done[m.id] || tried[m.id]).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 pb-2 border-b border-primary/10">
        <Sparkles className="w-4 h-4 text-amber-400" />
        <h3 className="typo-heading text-foreground">{ht.power_moves}</h3>
        <span className="typo-caption ml-auto" data-testid="power-moves-progress">
          {tx(ht.moves_used, { used: usedCount, total: POWER_MOVES.length })}
        </span>
      </div>

      {POWER_MOVE_GROUPS.map((group) => (
        <div key={group.key} className="space-y-2">
          <div className="flex items-center gap-2 pl-1">
            <group.icon className={`w-3.5 h-3.5 ${group.color}`} />
            <span className="text-[11px] font-semibold text-foreground uppercase tracking-wider">{ht[group.labelKey]}</span>
            <div className="flex-1 h-px bg-primary/5 ml-1" />
          </div>
          {POWER_MOVES.filter((move) => move.group === group.key).map((move) => (
            <PowerMoveRow key={move.id} move={move} />
          ))}
        </div>
      ))}
    </div>
  );
}
