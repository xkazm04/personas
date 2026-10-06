/**
 * The deck's full key map, behind ONE affordance: a quiet "Keys ?" in the tray
 * head that opens a compact glass overlay (also `?`). Everyday keys are already
 * printed inside the buttons; this is the reference, never wallpaper.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { Keyboard } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import type { DecisionModalType } from '../../../model/decisionModel';
import { Key } from './Key';

type Entry = [keys: string[], label: string];

const WALK: Entry = [['←', '→'], 'walk the queue'];
const SCROLL: Entry = [['↑', '↓'], 'scroll the card'];
const BACK: Entry = [['Esc'], 'undo armed, then back'];
const SKIP: Entry = [['S'], 'later — under the stack'];

const BY_TYPE: Record<DecisionModalType, Entry[]> = {
  approval: [[['A'], 'approve'], [['R'], 'reject (R again or ↵ confirms)'], [['1-9'], 'branch / reason'], SKIP, WALK, SCROLL, BACK],
  backlog: [[['A'], 'accept'], [['R'], 'reject (R again or ↵ confirms)'], [['1'], 'build now'], SKIP, WALK, SCROLL, BACK],
  report: [[['D'], 'done — mark read'], [['1'], 'follow up in chat'], [['⇧1-5'], 'rate'], SKIP, WALK, SCROLL, BACK],
  chat: [[['Space'], 'reply'], [['↵'], 'send'], [['D'], 'done'], SKIP, WALK, SCROLL, BACK],
};

const COUNCIL: Entry[] = [[['A', '↵'], 'approve (arm, confirm)'], [['R'], 'send back with a reason'], SKIP, WALK, SCROLL, BACK];

/** The spine verbs read as the card names them (Resolve / Dismiss on an incident). */
function relabel(entries: Entry[], labels?: { accept: string; reject: string }): Entry[] {
  if (!labels) return entries;
  return entries.map(([keys, label]): Entry => [
    keys,
    label === 'approve' || label === 'accept' ? labels.accept.toLowerCase() : label.startsWith('reject') ? label.replace('reject', labels.reject.toLowerCase()) : label,
  ]);
}

export function KeyMap({ type, isCouncil, labels, open, onToggle }: {
  type: DecisionModalType;
  isCouncil: boolean;
  labels?: { accept: string; reject: string };
  open: boolean;
  onToggle: () => void;
}) {
  const still = useReducedMotion();
  const entries = relabel(isCouncil ? COUNCIL : BY_TYPE[type], type === 'approval' || type === 'backlog' ? labels : undefined);
  return (
    <div className="relative">
      <Tooltip content="Every key for this card (?)">
        <Button
          variant="ghost"
          size="xs"
          onClick={onToggle}
          aria-expanded={open}
          aria-label="Keys"
          icon={<Keyboard className="h-3.5 w-3.5" aria-hidden />}
          className="r2a-btn r2a-keysbtn"
          data-testid="r2a-keys"
        >
          <Key>?</Key>
        </Button>
      </Tooltip>
      <AnimatePresence>
        {open && (
          <motion.div
            role="region"
            aria-label="Keys"
            initial={still ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="r2a-keymap r2a-glass r2a-hairline"
            data-testid="r2a-keymap"
          >
            {entries.map(([keys, label]) => (
              <div key={label} className="contents">
                <span className="flex items-center justify-end gap-1">{keys.map((k) => <Key key={k}>{k}</Key>)}</span>
                <span className="typo-caption text-foreground">{label}</span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
