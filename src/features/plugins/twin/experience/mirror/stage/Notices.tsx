/**
 * The three moments the lane says something other than a question:
 *
 * - the guide could not write a turn — calm, and never "done": the slot stays
 *   open and the fields layer is the way through without it;
 * - every setup slot is filled except Memories, which only training rounds can
 *   fill (a setup-stage answer is not stored, by the session's own rule), so
 *   the lane offers the switch rather than asking questions it would drop;
 * - every slot is set — readiness says so, not the guide.
 */

import { motion } from 'framer-motion';
import { GraduationCap, RotateCcw, Sparkles, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';

export function GuideDownNotice({ onRetry, onFields }: { onRetry: () => void; onFields: () => void }) {
  const { t } = useTranslation();
  const mr = t.twin.experience_mirror.notices;
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-card border border-status-warning/30 bg-status-warning/8 px-4 py-2.5"
      data-testid="mr-guide-down"
    >
      <TriangleAlert className="w-4 h-4 text-status-warning flex-shrink-0" aria-hidden />
      <span className="typo-body text-foreground flex-1 min-w-[14rem]">{t.twin.setup.generatorError.title}</span>
      <Button variant="ghost" size="sm" onClick={onRetry} icon={<RotateCcw className="w-3.5 h-3.5" />}>
        {mr.retry}
      </Button>
      <Button variant="secondary" size="sm" onClick={onFields} icon={<SlidersHorizontal className="w-3.5 h-3.5" />}>
        {t.twin.setup.generatorError.action}
      </Button>
    </div>
  );
}

export function TrainingInvite({ onStart }: { onStart: () => void }) {
  const { t } = useTranslation();
  const mr = t.twin.experience_mirror.notices;
  return (
    <div
      className="mr-frame mr-frame-lit rounded-modal px-6 py-7 space-y-3 text-center"
      data-testid="mr-training-invite"
    >
      <GraduationCap className="w-7 h-7 mx-auto text-primary" aria-hidden />
      <h3 className="typo-heading-lg text-foreground">{mr.inviteTitle}</h3>
      <p className="typo-body-lg text-foreground max-w-lg mx-auto">{mr.inviteBody}</p>
      <Button variant="accent" accentColor="violet" onClick={onStart} data-testid="mr-training-invite-start">
        {mr.inviteStart}
      </Button>
    </div>
  );
}

export function CompleteNotice({ name, onTrain, onClose }: { name: string; onTrain: () => void; onClose: () => void }) {
  const { t, tx } = useTranslation();
  const mr = t.twin.experience_mirror.notices;
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="mr-frame mr-frame-lit rounded-modal px-6 py-8 space-y-3 text-center"
      data-testid="mr-complete"
    >
      <Sparkles className="w-8 h-8 mx-auto text-primary" aria-hidden />
      <h3 className="typo-heading-lg text-foreground">{tx(mr.completeTitle, { name })}</h3>
      <p className="typo-body-lg text-foreground max-w-lg mx-auto">{mr.completeBody}</p>
      <div className="flex justify-center gap-2 pt-1">
        <Button variant="accent" accentColor="violet" onClick={onTrain} data-testid="mr-complete-train">
          {mr.completeTrain}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {mr.completeClose}
        </Button>
      </div>
    </motion.div>
  );
}
