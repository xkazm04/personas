import { Check, ChevronRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { launchPowerMove } from './launchPowerMove';
import { usePowerMovesStore } from './powerMovesStore';
import type { PowerMove } from './registry';

/**
 * One quest row: icon, title, used-state badge, and a "Try it" affordance —
 * a single line per move. The whole row is the launch button — clicking deep
 * links into the real surface and flashes the landing anchor.
 */
export function PowerMoveRow({ move }: { move: PowerMove }) {
  const { t } = useTranslation();
  const ht = t.home.learning;
  const used = usePowerMovesStore((s) => Boolean(s.done[move.id] || s.tried[move.id]));

  return (
    <button
      type="button"
      onClick={() => launchPowerMove(move)}
      data-testid={`power-move-${move.id}`}
      className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-modal border border-primary/8 bg-secondary/5 hover:bg-secondary/15 hover:border-primary/12 transition-all group"
    >
      <div className="w-7 h-7 rounded-card bg-secondary/30 border border-primary/10 flex items-center justify-center flex-shrink-0 group-hover:bg-secondary/50 transition-colors">
        <move.icon className={`w-3.5 h-3.5 ${move.color}`} />
      </div>
      <h4 className="flex-1 min-w-0 typo-body font-medium text-foreground truncate">{ht[move.titleKey]}</h4>
      {used && (
        <StatusBadge variant="success" size="sm" icon={<Check className="w-2.5 h-2.5" />} className="flex-shrink-0">
          {ht.used_badge}
        </StatusBadge>
      )}
      <span className="inline-flex items-center gap-0.5 typo-caption text-primary opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        {ht.try_it}
        <ChevronRight className="w-3.5 h-3.5" />
      </span>
    </button>
  );
}
