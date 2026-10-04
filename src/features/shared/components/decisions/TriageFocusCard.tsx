/** @catalog TriageFocus part: one item card - persona, chips, age, decision carousel and the deck body. */
// TriageFocusCard — one item, read and ruled on.
//
// The prose half is `TriageCardBody`, the deck's own renderer, NOT a second
// implementation of it: it already knows how to draw every kind the unified
// queue produces (headline, alert banner, markdown body with its `## ` section
// blocks, the why-raised block, the evidence dump). A second renderer for one
// model drifts from the first within a feature.
//
// What this file adds around it is what the donor had and the deck's modal did
// not: the raising persona's face, the item's chips, its age, and — when the
// item carries several decision options — the carousel between the header and
// the prose.
//
// NO `h-full`. The donor assumed it owned the page (`flex h-full` on its root,
// `h-full` on the empty state), which is exactly what stops a component being
// shared: dropped into the Monitor's 320px dock that assumption collapses the
// card to nothing. The height here comes from the container; the body scrolls
// inside whatever it is given.
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import { Chip, PersonaIcon, TONE_TEXT, TriageCardBody, type TriageItem } from '@/features/shared/triage/triageFocusBridge';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';

import { TriageFocusOptionCard, TriageFocusOptionStrip } from './TriageFocusOptions';
import { CARD_SPRING, CARD_VARIANTS, STILL_SPRING, STILL_VARIANTS } from './triageFocusMotion';
import type { TriageFocusController, TriagePersonaAccent } from './useTriageFocus';

function CardHeader({ item, personaAccent }: { item: TriageItem; personaAccent?: TriagePersonaAccent }) {
  // The caller's ink, never its layout: the class is APPENDED to `typo-title`
  // rather than replacing it, so a resolver can only change colour and the
  // card keeps the name's size, weight and truncation. See
  // `TriagePersonaAccent` for why the colour cannot be computed here.
  const accent = personaAccent?.(item);
  return (
    <div className="flex items-start gap-3">
      <PersonaIcon
        icon={item.personaIcon ?? null}
        color={item.source.color ?? null}
        name={item.source.label}
        display="framed"
        frameSize="lg"
      />
      <div className="min-w-0 flex-1">
        <span
          className={`typo-title block truncate${accent?.className ? ` ${accent.className}` : ''}`}
          style={accent?.style}
        >
          {item.source.label}
        </span>
        {item.source.sublabel && (
          <span className="typo-caption block truncate">{item.source.sublabel}</span>
        )}
      </div>
      <RelativeTime timestamp={item.createdAt} className="typo-caption flex-shrink-0" />
    </div>
  );
}

export function TriageFocusCard({ item, ctl, personaAccent }: {
  item: TriageItem;
  ctl: TriageFocusController;
  personaAccent?: TriagePersonaAccent;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const still = useReducedMotion();
  const { options, option, optionIndex, optionDir, optionVerdicts, accepted, rejected, undecided } = ctl;
  const decided = accepted + rejected;

  return (
    <AnimatePresence mode="wait" custom={ctl.dir}>
      <motion.article
        key={item.id}
        custom={ctl.dir}
        variants={still ? STILL_VARIANTS : CARD_VARIANTS}
        initial="enter"
        animate="center"
        exit="exit"
        transition={still ? STILL_SPRING : CARD_SPRING}
        className="flex min-h-0 w-full flex-1 flex-col gap-3 overflow-hidden p-4"
        data-testid="triage-focus-card"
      >
        <CardHeader item={item} personaAccent={personaAccent} />

        {item.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {item.tags.map((tag) => (
              <Chip key={tag.id} label={tag.label} tone={tag.tone} icon={tag.icon} />
            ))}
          </div>
        )}

        {options.length > 1 && (
          <TriageFocusOptionStrip
            options={options}
            index={optionIndex}
            verdicts={optionVerdicts}
            onSelect={ctl.selectOption}
            onPrev={ctl.prevOption}
            onNext={ctl.nextOption}
            onClear={ctl.clearOptions}
            decidedCount={decided}
          />
        )}

        {option && (
          <TriageFocusOptionCard
            option={option}
            verdict={optionVerdicts[option.id]}
            onDecide={(v) => ctl.decideOption(option.id, v)}
            direction={optionDir}
          />
        )}

        {decided > 0 && (
          <div className="flex flex-wrap items-center gap-3 typo-caption" data-testid="triage-focus-summary">
            {accepted > 0 && <span className={TONE_TEXT.success}>{tx(m.triage_focus_accepted, { count: accepted })}</span>}
            {rejected > 0 && <span className={TONE_TEXT.danger}>{tx(m.triage_focus_rejected, { count: rejected })}</span>}
            {undecided > 0 && <span className={TONE_TEXT.neutral}>{tx(m.triage_focus_undecided, { count: undecided })}</span>}
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col">
          <TriageCardBody item={item} isTop />
        </div>
      </motion.article>
    </AnimatePresence>
  );
}
