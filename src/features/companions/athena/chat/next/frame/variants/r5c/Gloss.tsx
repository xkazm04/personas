/**
 * Folio · glosses: what the machine did inside a turn (lookups, dispatches,
 * reports) and her own asides, kept out of the speech. Folded, a gloss is a
 * pilcrow and a count under the speaker's name; opened, a ruled block of short
 * marginal lines under her words, each led by its kind in small caps.
 */

import { motion } from 'framer-motion';
import { CornerDownRight } from 'lucide-react';
import type { CompanionMessage } from '@/api/companion';
import Button from '@/features/shared/components/buttons/Button';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { useAthenaStore } from '../../../../../athenaStore';
import { MACHINE_TONE, type Turn } from '../../../exchange';
import { NEXT_COPY as N } from '../../../nextCopy';
import { FOLIO_COPY as C } from './copy';
import { FOLIO_EASE } from './marks';

export function GlossToggle({ count, open, onToggle }: { count: number; open: boolean; onToggle: () => void }) {
  return (
    <Button
      variant="ghost"
      size="xs"
      className="r5c-gloss-toggle"
      onClick={onToggle}
      aria-expanded={open}
      data-testid="companion-r5c-gloss"
    >
      <span aria-hidden className="r5c-gloss-pilcrow">¶</span>
      <span className="typo-caption italic">{C.glosses(count)}</span>
    </Button>
  );
}

/** A machine row's words without its bracketed source tag. */
function glossText(content: string): string {
  return content.replace(/^\s*\[[^\]]+\]\s*/, '').replace(/^fleet-(?:event|orchestration)\s+/, '').trim();
}

export function GlossNotes({ turn }: { turn: Turn }) {
  const { shouldAnimate } = useMotion();
  return (
    <motion.ol
      className="r5c-gloss"
      initial={shouldAnimate ? { opacity: 0, height: 0 } : false}
      animate={{ opacity: 1, height: 'auto' }}
      transition={{ duration: shouldAnimate ? 0.28 : 0, ease: FOLIO_EASE }}
      data-testid="companion-r5c-gloss-notes"
    >
      {turn.asides.map((a, i) => (
        <li key={`aside-${i}`} className="r5c-gloss-line">
          <span className="r5c-sc typo-label r5c-gloss-kind text-primary">{C.her}</span>
          <span className="typo-caption italic">{a}</span>
        </li>
      ))}
      {turn.machine.map((m) => (
        <li key={m.id} className="r5c-gloss-line">
          <span className="r5c-sc typo-label r5c-gloss-kind" style={{ color: MACHINE_TONE[m.kind] }}>
            {N.machine[m.kind]}
          </span>
          <span className="typo-caption r5c-gloss-text">{glossText(m.content)}</span>
        </li>
      ))}
    </motion.ol>
  );
}

/** "Set aside for you": what this turn left on your queue, opening the folio. */
export function SetAside({ reply, onOpen }: { reply: CompanionMessage | null; onOpen: () => void }) {
  const summary = useAthenaStore((s) => (reply ? s.turnSummaryByEpisodeId[reply.id] : undefined));
  if (!summary || !(summary.approvals > 0 || summary.chatCards > 0 || summary.continuation)) return null;
  const parts = [
    summary.approvals > 0 && N.approvalsN(summary.approvals),
    summary.chatCards > 0 && N.cardsN(summary.chatCards),
    summary.continuation && N.continues,
  ].filter(Boolean);
  return (
    <Button variant="link" size="sm" className="r5c-setaside" onClick={onOpen} icon={<CornerDownRight className="w-3.5 h-3.5" aria-hidden />}>
      <span className="typo-caption">
        {C.setAside}: {parts.join(' · ')}
      </span>
    </Button>
  );
}
