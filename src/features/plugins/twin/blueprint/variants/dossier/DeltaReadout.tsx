/**
 * Dossier (WP9): what the last answer did, on the stage tile it landed on.
 * `instant` - the answer is recorded and being scored: the topic and kind it
 * was about, and a ghost where the gain will land (loading pattern v2, no
 * spinner). `reconciled` - the coverage it added and the model's one-line
 * reason. Each phase enters once (framer, opacity only under reduced motion).
 */
import { motion } from 'framer-motion';

import { Dot, Ghost, Meta } from '@/features/shared/components/kit';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';
import { formatNumeric } from '@/lib/utils/formatters';

import type { BlueprintDelta } from '../../blueprintContract';
import { useTopicLabel } from './TopicBars';

const ENTER = { duration: 0.35, ease: [0.22, 1, 0.36, 1] } as const;
const ENTER_REDUCED = { duration: 0.15, ease: 'linear' } as const;

export function DeltaReadout({ delta, reduced }: { delta: BlueprintDelta; reduced: boolean }) {
  const { t, tx, language } = useTranslation();
  const tb = t.twin.blueprint;
  const topicLabel = useTopicLabel();
  const subject = <Meta parts={[delta.topicId ? topicLabel(delta.topicId) : null, delta.kind ? tb.kinds[delta.kind] : null]} />;
  const reconciled = delta.phase === 'reconciled';

  return (
    <motion.div
      key={`${delta.answeredStepId}:${delta.phase}`}
      className="dossier-readout k-in"
      data-phase={delta.phase}
      data-testid="dossier-readout"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={reduced ? ENTER_REDUCED : ENTER}
    >
      {reconciled ? (
        <>
          {delta.coverageGain !== null && (
            <Numeric className="typo-heading text-status-success dossier-readout__gain" as="span">
              {tx(tb.delta.gain, { gain: formatNumeric(delta.coverageGain, 'ratio', { precision: 0, language }) })}
            </Numeric>
          )}
          <span className="typo-caption dossier-readout__subject" data-testid="dossier-readout-subject">{subject}</span>
          {delta.why && (
            <span className="dossier-readout__why">
              <span className="typo-eyebrow dossier-key">{tb.delta.why}</span>
              <span className="typo-body">{delta.why}</span>
            </span>
          )}
        </>
      ) : (
        <>
          <span className="dossier-readout__head">
            <Dot tone="primary" glyph="live" />
            <span className="typo-heading">{tb.delta.recorded}</span>
          </span>
          <span className="typo-caption dossier-readout__subject">{subject}</span>
          <span className="dossier-readout__scoring">
            <span className="typo-caption">{tb.delta.scoring}</span>
            <Ghost width="5rem" />
          </span>
        </>
      )}
    </motion.div>
  );
}
