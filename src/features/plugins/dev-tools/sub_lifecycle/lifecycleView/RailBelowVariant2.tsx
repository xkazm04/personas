/**
 * VARIANT 2 - EDITORIAL. "The practice set like a well-made page."
 *
 * Same arrangement, same data, same reading order as the baseline. Every
 * component is redrawn with type, rules and marks instead of boxes and fills:
 *
 * - HEADLINE as a PULL QUOTE: a kicker in the verdict's ink, the sentence one
 *   display step up, and a short rule drawn under it. The words set in one by
 *   one when the verdict is first shown or changes - a reading pace, not a loop.
 * - RAIL as a table of contents: numbered entries, state as each entry's
 *   underline, evidence as printer's marks (`EditorialRail`).
 * - LEGEND as a KEY line: the underline samples and the four marks, each with
 *   how many steps / which outcome it stands for.
 * - STATE as an article with a hero ordinal, figure tally, lede and a
 *   leader-dotted binding list (`EditorialState`); LEDGER rows as bylines
 *   (`editorialColumns`).
 */
import { AnimatePresence, motion } from 'framer-motion';

import { Numeric } from '@/features/shared/components/display/Numeric';

import { JourneyGhost } from '../journey/JourneyGhost';
import { bindingStateLabel } from '../journey/journeyLabels';
import { LEGEND_STATES, STATE_TEXT } from '../journey/journeyStyles';
import { useLifecycleViewModel } from './context';
import { LifecycleActions } from './blocks/LifecycleActions';
import { OutcomeMark, UNDERLINE } from './EditorialMarks';
import { EditorialRail } from './EditorialRail';
import { EditorialState } from './EditorialState';
import { editorialColumns } from './editorialColumns';
import { VariantLedger } from './VariantLedger';
import { OUTCOMES, stateCounts } from './variantShared';

function PullQuote() {
  const { dl, headline, headlineState } = useLifecycleViewModel();
  const ink = headlineState ? STATE_TEXT[headlineState] : 'text-foreground';
  const words = headline.split(' ');
  return (
    <div className="mx-auto max-w-3xl text-center space-y-2">
      {headlineState && <p className={`typo-eyebrow ${ink}`}>{bindingStateLabel(dl, headlineState)}</p>}
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={headline}
          className={`typo-heading-lg ${ink}`}
          data-testid="lc-weakest"
          aria-label={headline}
          exit={{ opacity: 0, transition: { duration: 0.1 } }}
        >
          {words.map((w, i) => (
            <motion.span
              key={`${i}-${w}`}
              aria-hidden
              className="inline-block whitespace-pre"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24, delay: Math.min(i, 24) * 0.022 }}
            >
              {i < words.length - 1 ? `${w} ` : w}
            </motion.span>
          ))}
        </motion.p>
      </AnimatePresence>
      <motion.span
        aria-hidden
        className="mx-auto block h-px w-16 bg-primary/40"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.4, delay: 0.3 }}
      />
    </div>
  );
}

function KeyLine() {
  const { dl, order } = useLifecycleViewModel();
  const counts = stateCounts(order);
  return (
    <div className="flex flex-wrap items-baseline justify-center gap-x-5 gap-y-2" data-testid="lc-legend">
      {LEGEND_STATES.map((s) => (
        <span key={s} className="flex items-baseline gap-1.5 typo-label text-foreground">
          <span aria-hidden className={`block w-4 self-center ${UNDERLINE[s]}`} />
          {bindingStateLabel(dl, s)}
          <Numeric value={counts[s]} className="typo-caption" />
        </span>
      ))}
      <span aria-hidden className="h-3 w-px self-center bg-primary/20" />
      <span className="flex items-center gap-2 typo-caption">
        <span className="flex items-center gap-1" aria-hidden>
          {OUTCOMES.map((o) => <OutcomeMark key={o} outcome={o} />)}
        </span>
        {dl.lc_legend_evidence}
      </span>
    </div>
  );
}

export function RailBelowVariant2() {
  const { order, loading } = useLifecycleViewModel();
  return (
    <div className="space-y-6 pb-6" data-testid="lc-journey">
      <LifecycleActions />
      <PullQuote />
      {order.length > 0 ? <EditorialRail /> : loading ? <JourneyGhost /> : null}
      <KeyLine />
      <div className="min-h-[26rem] border-t border-primary/15 pt-6 space-y-5" data-testid="lc-state-region">
        <EditorialState />
        <div className="h-[17rem]">
          <VariantLedger columnsFor={editorialColumns} tableId="lifecycle-evidence-v2" rowHeight={44} />
        </div>
      </div>
    </div>
  );
}
