import { Check, ChevronRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { launchPowerMove } from './launchPowerMove';
import { usePowerMovesStore } from './powerMovesStore';
import type { PowerMove } from './registry';

/**
 * One quest row: icon, title + value-prop hook, used-state badge, and a
 * "Try it" affordance. The whole row is the launch button — clicking deep
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
      className="w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-modal border border-primary/8 bg-secondary/5 hover:bg-secondary/15 hover:border-primary/12 transition-all group"
    >
      <div className="w-7 h-7 rounded-card bg-secondary/30 border border-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5 group-hover:bg-secondary/50 transition-colors">
        <move.icon className={`w-3.5 h-3.5 ${move.color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <h4 className="typo-body font-medium text-foreground truncate">{ht[move.titleKey]}</h4>
          {used && (
            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-medium px-1.5 py-0.5 rounded-input bg-emerald-500/10 border border-emerald-500/20 flex-shrink-0">
              <Check className="w-2.5 h-2.5" />
              {ht.used_badge}
            </span>
          )}
        </div>
        <p className="typo-caption mt-0.5">{ht[move.hookKey]}</p>
      </div>
      <span className="inline-flex items-center gap-0.5 typo-caption text-primary opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-1">
        {ht.try_it}
        <ChevronRight className="w-3.5 h-3.5" />
      </span>
    </button>
  );
}
