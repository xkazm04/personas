/**
 * Progress, as a four-suit bar: each segment is one slot, filled by its
 * readiness status, with the readiness score beside it. `deriveReadiness` is
 * the only thing that moves it — the generator's opinion never does.
 */

import { motion } from 'framer-motion';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import type { SetupChecklistItem } from '../../../setup/setupContract';
import type { TwinSlotStatus } from '../../../shared/twinStatus';
import { SUITS } from '../suits';

const FILL: Record<TwinSlotStatus, string> = { set: '100%', partial: '50%', empty: '0%' };

export function ScoreMeter({ checklist, score }: { checklist: SetupChecklistItem[]; score: number }) {
  const { t, tx } = useTranslation();
  const reduced = useReducedMotion();
  const label = tx(t.twin.experience_opus.table.ready, { score });

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={score}
      aria-label={label}
      className="flex items-center gap-3"
      data-testid="xo-score"
    >
      <div className="flex gap-1">
        {checklist.map((item) => (
          <span
            key={item.id}
            className={`${SUITS[item.id].hue} relative w-10 h-2 rounded-pill bg-foreground/10 overflow-hidden`}
          >
            <motion.span
              className="absolute inset-y-0 left-0 rounded-pill bg-[var(--xo-hue)]"
              initial={false}
              animate={{ width: FILL[item.status] }}
              transition={reduced ? { duration: 0 } : { duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            />
          </span>
        ))}
      </div>
      <span className="typo-data text-foreground" aria-hidden>
        {label}
      </span>
    </div>
  );
}

export default ScoreMeter;
