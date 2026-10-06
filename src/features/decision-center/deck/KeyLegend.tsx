/**
 * The key map — behind ONE affordance ("Keys", or the ? key), never printed as
 * a standing bar. Every verb on the card already carries its key inset in its
 * own button; this overlay is the full grammar for the curious, in the card's
 * own verbs (Resolve / Dismiss on an incident, Install on a promotion).
 */
import { Fragment } from 'react';
import { motion } from 'framer-motion';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import type { DecisionModalType } from '../model/decisionModel';
import { COUNCIL_MIN_REASON } from '../roster/decisionCopy';
import type { Interpolate, MonitorCopy } from './deckMeta';
import { Keycap } from './parts';

type Entry = [keys: string[], label: string];
interface Verbs { accept: string; reject: string }

function entriesFor(m: MonitorCopy, tx: Interpolate, type: DecisionModalType, council: boolean, v: Verbs): Entry[] {
  const tail: Entry[] = [
    [['←', '→'], m.dc_deck_key_walk],
    [['↑', '↓'], m.dc_deck_key_scroll],
    [['Esc'], m.dc_deck_key_back],
    [['?'], m.dc_deck_key_help],
  ];
  const later: Entry = [['S'], m.dc_deck_key_later];
  const accept = v.accept.toLowerCase();
  const reject = v.reject.toLowerCase();
  if (council) {
    return [
      [['A', '↵'], tx(m.dc_deck_key_council_approve, { verb: accept })],
      [['R'], tx(m.dc_deck_key_council_reject, { verb: reject, count: COUNCIL_MIN_REASON })],
      later, ...tail,
    ];
  }
  switch (type) {
    case 'approval':
      return [[['A'], accept], [['R'], tx(m.dc_deck_key_reject_confirm, { verb: reject })], [['1-9'], m.dc_deck_key_branch], later, ...tail];
    case 'backlog':
      return [[['A'], accept], [['R'], tx(m.dc_deck_key_reject_confirm, { verb: reject })], [['1'], m.dc_deck_key_build_now], later, ...tail];
    case 'report':
      return [[['D'], m.dc_deck_key_done], [['1'], m.dc_deck_key_follow_up], [['⇧1-5'], m.dc_deck_key_rate], later, ...tail];
    case 'chat':
      return [[['Space'], m.dc_deck_key_reply], [['↵'], m.dc_deck_key_send], [['D'], m.dc_deck_key_done], later, ...tail];
  }
}

export function KeyMap({ type, isCouncil, labels }: { type: DecisionModalType; isCouncil: boolean; labels?: Verbs }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const still = useReducedMotion();
  const entries = entriesFor(m, tx, type, isCouncil, labels ?? { accept: m.dc_hub_key_accept, reject: m.dc_hub_key_reject });
  return (
    <motion.div
      initial={still ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={still ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
      transition={{ duration: 0.16 }}
      style={{ transformOrigin: 'top right' }}
      className="au-keys absolute right-0 top-full z-40 mt-2 grid w-[340px] grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 rounded-card p-4 typo-caption"
      role="group"
      aria-label={m.dc_deck_keys_aria}
      data-testid="deck-key-legend"
    >
      {entries.map(([keys, label]) => (
        <Fragment key={keys.join('+')}>
          <span className="flex items-center justify-end gap-1 text-foreground">{keys.map((k) => <Keycap key={k}>{k}</Keycap>)}</span>
          <span className="text-foreground">{label}</span>
        </Fragment>
      ))}
    </motion.div>
  );
}
