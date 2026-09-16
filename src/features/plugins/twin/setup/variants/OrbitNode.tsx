/**
 * OrbitNode — one of the four checklist slots, orbiting the twin's sigil.
 *
 * The node IS the status report: the disc fills from the bottom as the slot
 * completes (hollow → half → filled), which is the `twinStatus` shape channel
 * rendered as geometry rather than as a word, and the same table supplies the
 * colour. A reader who cannot separate the two colours still reads the fill.
 *
 * The focused slot is pulled forward — bigger, lit, above its siblings — so
 * "which question am I on" is answered by depth instead of by a sentence.
 * Only the `memories` slot carries a Hub jump, because it is the one setup
 * slot whose full surface lives there (`TWIN_SLOTS.memories.destination`).
 */

import { motion } from 'framer-motion';
import { ArrowUpRight, Sparkles } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { TWIN_FOCUS_ICON, twinStatusEntry, type TwinSlotId } from '../../shared/twinStatus';
import type { SetupChecklistItem, SetupFocus } from '../setupContract';

/** How far the disc is filled. Shape carries the status alongside colour. */
const FILL_HEIGHT: Record<string, string> = { set: '100%', partial: '50%', empty: '0%' };

export interface OrbitPlacement {
  left: string;
  top: string;
}

interface OrbitNodeProps {
  item: SetupChecklistItem;
  placement: OrbitPlacement;
  active: boolean;
  /** Entrance order, so the four arrive one after another — once, then still. */
  index: number;
  reduced: boolean;
  onFocus: (focus: SetupFocus) => void;
  /** Set only for the slot whose full surface lives in the Hub. */
  hubSlot?: TwinSlotId;
  onOpenHub: (slot: TwinSlotId) => void;
}

export function OrbitNode({
  item,
  placement,
  active,
  index,
  reduced,
  onFocus,
  hubSlot,
  onOpenHub,
}: OrbitNodeProps) {
  const { t } = useTranslation();
  const ts = t.twin.setup;
  const entry = twinStatusEntry(item.status);
  const Icon = TWIN_FOCUS_ICON[item.id] ?? Sparkles;

  return (
    <motion.div
      className="absolute w-28 md:w-32 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
      style={{ left: placement.left, top: placement.top, zIndex: active ? 2 : 1 }}
      initial={reduced ? false : { opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={reduced ? { duration: 0 } : { duration: 0.32, delay: 0.14 + index * 0.07, ease: 'easeOut' }}
      data-testid={`setup-orbit-node-${item.id}`}
    >
      <button
        type="button"
        onClick={() => onFocus(item.id)}
        aria-current={active ? 'step' : undefined}
        className="flex flex-col items-center gap-1.5 w-full rounded-card px-1 py-1 transition-colors hover:bg-secondary/30"
      >
        <motion.span
          animate={{ scale: active ? 1.14 : 1 }}
          transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 22 }}
          className={[
            'relative w-14 h-14 rounded-full overflow-hidden flex items-center justify-center transition-colors',
            entry.shape === 'hollow' ? 'border border-dashed' : 'border',
            active
              ? 'border-primary/60 bg-primary/10 shadow-elevation-3'
              : 'border-primary/20 bg-card/70 shadow-elevation-1',
          ].join(' ')}
        >
          {/* The fill. Transitions when the slot completes; never loops. */}
          <span
            aria-hidden
            className={`absolute inset-x-0 bottom-0 opacity-30 transition-[height] duration-500 ${entry.dot}`}
            style={{ height: FILL_HEIGHT[item.status] ?? '0%' }}
          />
          <Icon className="relative w-5 h-5 text-foreground" aria-hidden />
        </motion.span>

        <span className="typo-caption font-medium text-foreground leading-tight text-center">
          {ts.checklist[item.labelKey]}
        </span>
        {/* The slot's one measured fact — the only text a node ever carries. */}
        <span className={`typo-caption tabular-nums text-center truncate max-w-full ${entry.text}`}>
          {item.detail}
        </span>
        <span className="sr-only">{t.twin.status[entry.labelKey]}</span>
      </button>

      {hubSlot && (
        <button
          type="button"
          onClick={() => onOpenHub(hubSlot)}
          data-testid={`setup-orbit-hub-${item.id}`}
          className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-primary/20 bg-secondary/30 typo-caption transition-colors hover:bg-secondary/60"
        >
          <ArrowUpRight className="w-3 h-3" aria-hidden />
          {ts.orbit.openHub}
        </button>
      )}
    </motion.div>
  );
}

export default OrbitNode;
