/**
 * The verdict stamp: a glass medallion (glyph + verb) that lands on the card
 * for the beat before it leaves. Reduced motion: a plain fade.
 */
import { motion } from 'framer-motion';
import { Check, CheckCheck, SkipForward, Send, X, type LucideIcon } from 'lucide-react';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { modalTypeOf, type DecisionItem } from '../../../model/decisionModel';
import type { Leave } from './deckMotion';

type Verdict = Exclude<Leave, 'walk'>;

const SAY: Record<Verdict, string> = { accept: 'success', reject: 'danger', done: 'accent', skip: 'neutral' };

export function stampLabel(item: DecisionItem, leave: Verdict): string {
  if (leave === 'done') return modalTypeOf(item.kind) === 'chat' ? 'Done' : 'Read';
  if (leave === 'skip') return item.verdictLabels.skip;
  if (leave === 'accept' && modalTypeOf(item.kind) === 'chat') return 'Sent';
  return leave === 'accept' ? item.verdictLabels.accept : item.verdictLabels.reject;
}

function glyph(item: DecisionItem, leave: Verdict): LucideIcon {
  if (leave === 'reject') return X;
  if (leave === 'skip') return SkipForward;
  if (leave === 'done') return CheckCheck;
  return modalTypeOf(item.kind) === 'chat' ? Send : Check;
}

export function DeckStamp({ item, leave }: { item: DecisionItem; leave: Verdict }) {
  const still = useReducedMotion();
  const Glyph = glyph(item, leave);
  return (
    <div className="r2a-stamp-layer" aria-hidden>
      <motion.span
        initial={still ? { opacity: 0 } : { opacity: 0, scale: 1.35 }}
        animate={still ? { opacity: 1 } : { opacity: 1, scale: 1 }}
        transition={still ? { duration: 0.1 } : { duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
        className="r2a-stamp r2a-say"
        data-r2a-say={SAY[leave]}
      >
        <span className="r2a-stamp__ring"><Glyph className="h-7 w-7" /></span>
        <span className="typo-heading-lg">{stampLabel(item, leave)}</span>
      </motion.span>
    </div>
  );
}
