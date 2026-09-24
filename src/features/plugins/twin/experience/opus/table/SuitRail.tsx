/**
 * The four suits, as piles down the left of the table. Each pile is a slot:
 * its status (colour AND shape, from the one `twinStatus` table), its
 * measured `have/target`, and a click that deals that suit's next question.
 * A pile that just completed flares once — the reward for finishing a slot,
 * which only readiness can grant.
 */

import { motion } from 'framer-motion';
import { Check, ExternalLink } from 'lucide-react';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import { hubSlotForFocus, twinStatusEntry, type TwinSlotId } from '../../../shared/twinStatus';
import type { SetupChecklistItem, SetupFocus } from '../../../setup/setupContract';
import { SUITS, SUIT_TEXT } from '../suits';

interface SuitRailProps {
  items: SetupChecklistItem[];
  focus: SetupFocus;
  /** The suit that just completed, for its one flare. */
  flare: SetupFocus | null;
  onFocus: (focus: SetupFocus) => void;
  onOpenHub: (slot: TwinSlotId) => void;
}

export function SuitRail({ items, focus, flare, onFocus, onOpenHub }: SuitRailProps) {
  const { t, tx } = useTranslation();
  const xo = t.twin.experience_opus;
  const reduced = useReducedMotion();

  return (
    <nav aria-label={xo.suits.label} className="space-y-3" data-testid="xo-suits">
      <p className="typo-label px-1">{xo.suits.label}</p>
      {items.map((item) => {
        const suit = SUITS[item.id];
        const entry = twinStatusEntry(item.status);
        const active = item.id === focus;
        const done = item.status === 'set';
        const hub = hubSlotForFocus(item.id);
        return (
          <div key={item.id} className={`relative ${suit.hue}`}>
            {/* The pile under the top card: two backs, offset. */}
            <span aria-hidden className="xo-back rounded-card absolute inset-0 translate-x-1.5 translate-y-1.5 opacity-60" />
            <span aria-hidden className="xo-back rounded-card absolute inset-0 translate-x-0.5 translate-y-0.5 opacity-80" />
            <motion.button
              type="button"
              onClick={() => onFocus(item.id)}
              aria-current={active ? 'step' : undefined}
              data-picked={active}
              data-testid={`xo-suit-${item.id}`}
              animate={
                flare === item.id && !reduced ? { scale: [1, 1.06, 1], rotate: [0, -1.5, 0] } : undefined
              }
              transition={{ duration: 0.6 }}
              className={`focus-ring relative w-full xo-card xo-foil rounded-card px-3 py-3 flex items-center gap-3 text-left ${
                active ? 'xo-foil-live xo-glow' : done ? 'xo-foil-quiet' : ''
              }`}
            >
              <suit.Icon className={`w-5 h-5 flex-shrink-0 ${SUIT_TEXT}`} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block typo-title-lg text-foreground truncate">{xo.suits[item.id]}</span>
                <span className={`flex items-center gap-1.5 typo-caption tabular-nums ${entry.text}`}>
                  <span aria-hidden className={`w-2 h-2 rounded-full ${entry.dot}`} />
                  {tx(xo.suits.statusLine, { status: t.twin.status[entry.labelKey], detail: item.detail })}
                </span>
              </span>
              {done && <Check className="w-4 h-4 text-status-success flex-shrink-0" aria-hidden />}
            </motion.button>
            {hub && active && (
              <button
                type="button"
                onClick={() => onOpenHub(hub)}
                data-testid={`xo-suit-hub-${item.id}`}
                className="focus-ring relative mt-1.5 ml-3 inline-flex items-center gap-1.5 typo-caption hover:text-foreground transition-colors"
              >
                <ExternalLink className="w-3 h-3" aria-hidden />
                {xo.suits.openHub}
              </button>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export default SuitRail;
