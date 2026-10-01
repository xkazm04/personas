/**
 * What lands on the answered plate in stage mode: a check the moment the answer
 * is recorded, the coverage gain once the reconcile pass scores it. A one-shot
 * drop onto the plate (framer, a fade only under reduced motion); the words for
 * the same moment live in the readout.
 */
import { Check } from 'lucide-react';
import { motion } from 'framer-motion';

import { Numeric } from '@/features/shared/components/display/Numeric';

import type { BlueprintDelta } from '../../blueprintContract';

export function DeltaChip({ delta, reduced }: { delta: BlueprintDelta; reduced: boolean }) {
  const scored = delta.phase === 'reconciled' && delta.coverageGain !== null;
  return (
    <span className="strata-chip-anchor" data-testid="strata-delta-chip" data-phase={delta.phase}>
      <motion.span
        key={`${delta.answeredStepId}:${delta.phase}`}
        className="strata-chip typo-data"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: -26, scale: 1.2 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: reduced ? 0.2 : 0.45, delay: reduced ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }}
      >
        {scored ? (
          <>
            +<Numeric value={delta.coverageGain} unit="ratio" precision={0} />
          </>
        ) : (
          <Check className="w-4 h-4" aria-hidden />
        )}
      </motion.span>
    </span>
  );
}
