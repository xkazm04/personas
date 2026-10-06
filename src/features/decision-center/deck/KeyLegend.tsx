/**
 * The key map — behind ONE affordance ("Keys", or the ? key), never printed as
 * a standing bar. Every verb on the card already carries its key inset in its
 * own button; this overlay is the full grammar for the curious, in the card's
 * own verbs (Resolve / Dismiss on an incident, Install on a promotion).
 */
import { Fragment } from 'react';
import { motion } from 'framer-motion';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import type { DecisionModalType } from '../model/decisionModel';
import { Keycap } from './parts';

type Entry = [keys: string[], label: string];

const WALK: Entry = [['←', '→'], 'walk the queue'];
const SCROLL: Entry = [['↑', '↓'], 'scroll'];
const BACK: Entry = [['Esc'], 'undo armed, then back'];
const HELP: Entry = [['?'], 'this map'];

const BY_TYPE: Record<DecisionModalType, Entry[]> = {
  approval: [[['A'], 'approve'], [['R'], 'reject (R again or ↵ confirms)'], [['1-9'], 'branch'], [['S'], 'later'], WALK, SCROLL, BACK, HELP],
  backlog: [[['A'], 'accept'], [['R'], 'reject (R again or ↵ confirms)'], [['1'], 'build now'], [['S'], 'later'], WALK, SCROLL, BACK, HELP],
  report: [[['D'], 'done'], [['1'], 'follow up'], [['⇧1-5'], 'rate'], [['S'], 'later'], WALK, SCROLL, BACK, HELP],
  chat: [[['Space'], 'reply'], [['↵'], 'send'], [['D'], 'done'], [['S'], 'later'], WALK, SCROLL, BACK, HELP],
};

const COUNCIL: Entry[] = [[['A', '↵'], 'approve (arm, then confirm)'], [['R'], 'send back (12+ char reason)'], [['S'], 'later'], WALK, SCROLL, BACK, HELP];

function relabel(entries: Entry[], labels?: { accept: string; reject: string }): Entry[] {
  if (!labels) return entries;
  return entries.map(([keys, label]): Entry => [keys, label.replace(/^(approve|accept)\b/, labels.accept.toLowerCase()).replace(/^reject\b/, labels.reject.toLowerCase())]);
}

export function KeyMap({ type, isCouncil, labels }: { type: DecisionModalType; isCouncil: boolean; labels?: { accept: string; reject: string } }) {
  const still = useReducedMotion();
  const entries = relabel(isCouncil ? COUNCIL : BY_TYPE[type], type === 'approval' || type === 'backlog' ? labels : undefined);
  return (
    <motion.div
      initial={still ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={still ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
      transition={{ duration: 0.16 }}
      style={{ transformOrigin: 'top right' }}
      className="au-keys absolute right-0 top-full z-40 mt-2 grid w-[340px] grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 rounded-card p-4 typo-caption"
      role="group"
      aria-label="Keyboard map"
      data-testid="p2-key-legend"
    >
      {entries.map(([keys, label]) => (
        <Fragment key={label}>
          <span className="flex items-center justify-end gap-1 text-foreground">{keys.map((k) => <Keycap key={k}>{k}</Keycap>)}</span>
          <span className="text-foreground">{label}</span>
        </Fragment>
      ))}
    </motion.div>
  );
}
