/**
 * VARIANT 2 (Editorial) - the selected step's state, set as an ARTICLE. Same
 * content as `blocks/StepState`; the components that changed:
 *
 * - the head is the entry's ordinal as a large figure in the state's ink, the
 *   step name as the title, and phase / state as the kicker under it;
 * - the tally is four FIGURES with their outcome words as captions, parted by
 *   column rules, instead of one comma sentence;
 * - the rule is the LEDE, one type step up, because it is the text an agent is
 *   actually handed;
 * - bindings are a definition list with LEADER DOTS running from the mechanism
 *   to its state, the way a contents page joins a title to its page.
 *
 * Motion: walking the rail re-sets the article - head, figures, lede and list
 * fade up in that reading order (`staggerChildren`), once per selection.
 */
import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

import { Numeric } from '@/features/shared/components/display/Numeric';
import { announceImperative } from '@/features/shared/components/feedback/AriaLiveProvider';

import { bindingKindLabel, bindingStateLabel, outcomeLabel, stepLabel } from '../journey/journeyLabels';
import { OUTCOME_TEXT, STATE_TEXT } from '../journey/journeyStyles';
import { useLifecycleViewModel } from './context';
import { OutcomeMark, UNDERLINE } from './EditorialMarks';
import { OUTCOMES } from './variantShared';

const ARTICLE = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05 } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};
const PART = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: { duration: 0.22 } },
};

export function EditorialState() {
  const { dl, tx, order, selected } = useLifecycleViewModel();
  const label = selected ? stepLabel(dl, selected.id, selected.label) : null;

  useEffect(() => {
    if (!selected || !label) return;
    announceImperative(tx(dl.lc_node_label, { step: label, state: bindingStateLabel(dl, selected.strongestState) }));
  }, [selected, label, tx, dl]);

  if (!selected || !label) return null;
  const state = selected.strongestState;
  const ordinal = order.findIndex((n) => n.id === selected.id) + 1;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.article
        key={selected.id}
        variants={ARTICLE}
        initial="hidden"
        animate="show"
        exit="exit"
        className="space-y-5"
        data-testid="lc-step-state"
      >
        <motion.header variants={PART} className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="flex items-end gap-4 min-w-0 flex-1">
            <Numeric className={`typo-hero leading-none ${STATE_TEXT[state]}`}>{String(ordinal).padStart(2, '0')}</Numeric>
            <div className="min-w-0 pb-1">
              <h3 className="typo-title truncate">{label}</h3>
              <p className="typo-caption">
                {selected.phase === 'before' ? dl.lc_lane_before : dl.lc_lane_after}
                <span aria-hidden className="mx-1.5">/</span>
                <span className={`font-semibold ${STATE_TEXT[state]}`}>{bindingStateLabel(dl, state)}</span>
              </p>
            </div>
          </div>
          <dl
            className="flex divide-x divide-primary/15"
            aria-label={tx(dl.lc_detail_tally, { ...selected.tally })}
          >
            {OUTCOMES.map((o) => (
              <div key={o} className="flex flex-col-reverse items-center gap-0.5 px-4 first:pl-0 last:pr-0">
                <dt className={`flex items-center gap-1 typo-caption ${selected.tally[o] > 0 ? OUTCOME_TEXT[o] : ''}`}>
                  <OutcomeMark outcome={o} />
                  {outcomeLabel(dl, o)}
                </dt>
                <dd className="typo-data-lg text-foreground">
                  <Numeric value={selected.tally[o]} />
                </dd>
              </div>
            ))}
          </dl>
        </motion.header>

        <motion.span variants={PART} aria-hidden className={`block w-16 ${UNDERLINE[state]}`} />

        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-x-10 gap-y-4 items-start">
          <motion.section variants={PART} className="min-w-0 space-y-2">
            <h4 className="typo-eyebrow text-foreground">{dl.lc_detail_rule}</h4>
            <p className="typo-body-lg text-foreground leading-relaxed">{selected.rule}</p>
          </motion.section>

          <motion.section variants={PART} className="min-w-0 space-y-2">
            <h4 className="typo-eyebrow text-foreground">{dl.lc_detail_bindings}</h4>
            {selected.view.bindingViews.length === 0 && <p className="typo-caption">{dl.lc_state_phrase_advisory}</p>}
            <ul className="space-y-2 empty:hidden">
              {selected.view.bindingViews.map((b) => (
                <li key={b.kind} className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="typo-body text-foreground shrink-0">{bindingKindLabel(dl, b.kind)}</span>
                    <span aria-hidden className="mb-1 flex-1 border-b border-dotted border-primary/30" />
                    <span className={`typo-heading shrink-0 ${STATE_TEXT[b.state]}`}>{bindingStateLabel(dl, b.state)}</span>
                  </div>
                  {b.detail && <p className="typo-code truncate">{b.detail}</p>}
                </li>
              ))}
            </ul>
          </motion.section>
        </div>
      </motion.article>
    </AnimatePresence>
  );
}
