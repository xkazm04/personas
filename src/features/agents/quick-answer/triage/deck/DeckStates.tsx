// DeckStates — the two moments where there is no card to throw.
//
// Both are designed as arrivals rather than absences. The loading state deals
// three ghost cards into the same depth positions the real stack will occupy,
// so the surface has shape before it has data and nothing jumps when it lands.
// The cleared state is the payoff for the whole variant: someone who just
// cleared forty items in five minutes should be told so, in the largest type on
// the screen, not shown a grey "nothing here" box.
//
// Neither loops. The entry choreography is one-shot and gated on reduced
// motion; there is no ambient pulse anywhere in this file.
import { motion } from 'framer-motion';
import { Filter, PartyPopper } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useTranslation } from '@/i18n/useTranslation';

const GHOSTS = [0, 1, 2];

export function DeckLoading({ reduced }: { reduced: boolean }) {
  const { t } = useTranslation();

  return (
    <div className="relative h-full max-h-[34rem] min-h-[19rem] w-full max-w-[42rem]">
      <LoadingSpinner label={t.monitor.triage_loading} />
      {GHOSTS.map((i) => (
        <motion.div
          key={i}
          className="absolute inset-0"
          style={{ zIndex: 10 - i }}
          initial={reduced ? false : { scale: 1 - i * 0.05, y: i * 10 + 26, opacity: 0 }}
          animate={{ scale: 1 - i * 0.05, y: i * 10, opacity: 1 - i * 0.25 }}
          transition={{ type: 'spring', stiffness: 240, damping: 26, delay: reduced ? 0 : i * 0.08 }}
        >
          <div className="h-full w-full space-y-4 rounded-card border-2 border-primary/12 bg-background p-6 shadow-elevation-3">
            <div className="flex gap-2">
              <span className="h-5 w-20 rounded-pill bg-primary/10" />
              <span className="h-5 w-16 rounded-pill bg-primary/10" />
            </div>
            <span className="block h-7 w-3/4 rounded-input bg-primary/12" />
            <span className="block h-3 w-1/3 rounded-pill bg-primary/8" />
            <div className="space-y-2 pt-2">
              <span className="block h-3 w-full rounded-pill bg-primary/8" />
              <span className="block h-3 w-11/12 rounded-pill bg-primary/8" />
              <span className="block h-3 w-4/5 rounded-pill bg-primary/8" />
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

export function DeckCleared({
  decided,
  filtered,
  reduced,
  onReload,
}: {
  decided: number;
  /** True when the queue still holds items, just none of the active kinds. */
  filtered: boolean;
  reduced: boolean;
  onReload: () => void;
}) {
  const { t, tx } = useTranslation();
  const Icon = filtered ? Filter : PartyPopper;
  const body = filtered
    ? t.monitor.triage_filtered_body
    : decided > 0
      ? tx(
          decided === 1 ? t.monitor.triage_cleared_body_one : t.monitor.triage_cleared_body_other,
          { count: decided },
        )
      : t.monitor.triage_cleared_body_none;

  return (
    <motion.div
      className="flex max-w-[46ch] flex-col items-center gap-4 text-center"
      initial={reduced ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 220, damping: 24 }}
    >
      <motion.div
        className={`flex h-20 w-20 items-center justify-center rounded-full border ${
          filtered ? 'border-primary/25 bg-primary/10' : 'border-status-success/30 bg-status-success/10'
        }`}
        initial={reduced ? false : { scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 18, delay: reduced ? 0 : 0.06 }}
      >
        <Icon
          className={`h-9 w-9 ${filtered ? 'text-primary' : 'text-status-success'}`}
          aria-hidden
        />
      </motion.div>

      <h2 className="typo-hero text-foreground">
        {filtered ? t.monitor.triage_filtered_title : t.monitor.triage_cleared_title}
      </h2>

      <p className="typo-body-lg text-foreground">{body}</p>

      {!filtered ? (
        <Button
          variant="secondary"
          onClick={onReload}
          aria-label={t.monitor.triage_check_more}
          title={t.monitor.triage_check_more}
        >
          {t.monitor.triage_check_more}
        </Button>
      ) : null}
    </motion.div>
  );
}
