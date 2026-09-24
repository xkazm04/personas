/**
 * The three moments the table says something other than a question:
 *
 * - the guide could not deal a turn — calm, and never "done": the slot stays
 *   open and the typed fields are the way through without it;
 * - the setup suits are finished except Memories, which only training rounds
 *   fill (a setup-stage answer is not saved, by the session's own rule), so
 *   the table offers the switch instead of asking questions it would drop;
 * - every suit is set — readiness says so, not the guide — and the twin is
 *   ready: the reward card.
 */

import { motion } from 'framer-motion';
import { GraduationCap, PartyPopper, RotateCcw, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';

export function GuideDownNotice({ onRetry, onFields }: { onRetry: () => void; onFields: () => void }) {
  const { t } = useTranslation();
  const xo = t.twin.experience_opus.notices;
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-card border border-status-warning/30 bg-status-warning/8 px-4 py-2.5"
      data-testid="xo-guide-down"
    >
      <TriangleAlert className="w-4 h-4 text-status-warning flex-shrink-0" aria-hidden />
      <span className="typo-body text-foreground flex-1 min-w-[14rem]">{xo.guideDown}</span>
      <Button variant="ghost" size="sm" onClick={onRetry} icon={<RotateCcw className="w-3.5 h-3.5" />}>
        {xo.retry}
      </Button>
      <Button variant="secondary" size="sm" onClick={onFields} icon={<SlidersHorizontal className="w-3.5 h-3.5" />}>
        {xo.fields}
      </Button>
    </div>
  );
}

export function TrainingInvite({ onStart }: { onStart: () => void }) {
  const { t } = useTranslation();
  const xo = t.twin.experience_opus.notices;
  return (
    <div
      className="xo-suit-memories xo-card xo-card-raised xo-foil xo-foil-live xo-glow rounded-modal px-6 py-6 space-y-3 text-center"
      data-testid="xo-training-invite"
    >
      <GraduationCap className="w-8 h-8 mx-auto text-[var(--xo-hue)]" aria-hidden />
      <h3 className="typo-heading-lg text-foreground">{xo.inviteTitle}</h3>
      <p className="typo-body-lg text-foreground max-w-xl mx-auto">{xo.inviteBody}</p>
      <Button variant="accent" tone="agent" onClick={onStart} data-testid="xo-training-invite-start">
        {xo.inviteStart}
      </Button>
    </div>
  );
}

export function CompleteCard({ name, onTrain, onClose }: { name: string; onTrain: () => void; onClose: () => void }) {
  const { t, tx } = useTranslation();
  const xo = t.twin.experience_opus.notices;
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, rotateY: 90, scale: 0.9 }}
      animate={{ opacity: 1, rotateY: 0, scale: 1 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="xo-suit-identity xo-card xo-card-raised xo-foil xo-foil-live xo-holo xo-glow rounded-modal px-6 py-8 space-y-3 text-center"
      data-testid="xo-complete"
    >
      <PartyPopper className="w-9 h-9 mx-auto text-[var(--xo-hue)]" aria-hidden />
      <h3 className="typo-heading-lg text-foreground">{tx(xo.completeTitle, { name })}</h3>
      <p className="typo-body-lg text-foreground max-w-xl mx-auto">{xo.completeBody}</p>
      <div className="flex justify-center gap-2 pt-1">
        <Button variant="accent" tone="agent" onClick={onTrain} data-testid="xo-complete-train">
          {xo.completeTrain}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {xo.completeClose}
        </Button>
      </div>
    </motion.div>
  );
}
