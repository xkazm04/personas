/**
 * The key map, behind ONE quiet affordance: a "Keys ?" button in the card's
 * corner (or the ? key) opens a compact overlay listing the keys this card
 * answers to, in grammar order, with the card's own verbs. Keys are otherwise
 * printed once, on the action they fire.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { Keyboard } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Kbd } from '@/features/shared/triage/triageFocusBridge';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import type { DecisionModalType } from '../../../model/decisionModel';

type Entry = [keys: string[], label: string];

const WALK: Entry = [['←', '→'], 'walk the deck'];
const SCROLL: Entry = [['↑', '↓'], 'scroll'];
const BACK: Entry = [['Esc'], 'undo, then back'];

const BY_TYPE: Record<DecisionModalType, Entry[]> = {
  approval: [WALK, SCROLL, [['A'], 'approve'], [['R'], 'reject'], [['1-9'], 'branch'], [['S'], 'later'], BACK],
  backlog: [WALK, SCROLL, [['A'], 'accept'], [['R'], 'reject'], [['1'], 'build now'], [['S'], 'later'], BACK],
  report: [WALK, SCROLL, [['D'], 'done'], [['1'], 'follow up'], [['⇧1-5'], 'rate'], [['S'], 'later'], BACK],
  chat: [WALK, SCROLL, [['Space'], 'reply'], [['↵'], 'send'], [['D'], 'done'], [['S'], 'later'], BACK],
};

const COUNCIL: Entry[] = [WALK, SCROLL, [['A', '↵'], 'approve'], [['R'], 'send back'], [['S'], 'later'], BACK];

/** The spine verbs read as the card names them (Resolve / Dismiss on an incident, Install on a promotion). */
function relabel(entries: Entry[], labels?: { accept: string; reject: string }): Entry[] {
  if (!labels) return entries;
  return entries.map(([keys, label]): Entry => [keys, label === 'approve' || label === 'accept' ? labels.accept.toLowerCase() : label === 'reject' ? labels.reject.toLowerCase() : label]);
}

export function KeysButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={onToggle}
      aria-expanded={open}
      aria-label="Keyboard keys for this card"
      icon={<Keyboard className="h-3.5 w-3.5" aria-hidden />}
      className="r2b-keys-btn"
    >
      <span className="r2b-key inline-flex items-center gap-1.5 typo-caption text-current">Keys <Kbd>?</Kbd></span>
    </Button>
  );
}

export function KeyMap({ open, type, isCouncil, labels }: {
  open: boolean;
  type: DecisionModalType;
  isCouncil: boolean;
  labels?: { accept: string; reject: string };
}) {
  const still = useReducedMotion();
  const entries = relabel(isCouncil ? COUNCIL : BY_TYPE[type], type === 'approval' || type === 'backlog' ? labels : undefined);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="r2b-keys"
          initial={still ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          data-testid="r2b-key-map"
        >
          <span className="typo-eyebrow text-foreground">Keys for this card</span>
          <div className="r2b-keys-grid typo-caption">
            {entries.flatMap(([keys, label]) => [
              <span key={`k-${label}`} className="r2b-key">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>,
              <span key={`l-${label}`} className="text-foreground">{label}</span>,
            ])}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
