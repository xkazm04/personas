import type { ReactNode } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Lamp } from '@/features/decision-center/deck/parts';
import '@/features/decision-center/deck/aurora.css';

/* ----------------------------------------------------------------------------
 * ASK HEAD - the Decision Deck's card head, sized for a plate (WP12).
 *
 * The markup of `deck/CardHeader.tsx`: "GATES · REVIEW" said once with the
 * tier as a lamp (its word in a tooltip), the ask as the title (two balanced
 * lines, never cut mid-word), one context line, then the OUTCOME PAIR, "If you
 * approve: ..." lit over "If you reject: ..." quiet, so both verdicts are read
 * before either is pressed. The key is printed once, inside the verdict
 * button, never here. Needs an `au-scope` ancestor (the rail, the card).
 * -------------------------------------------------------------------------- */

export interface Outcome { verb: string; effect: string }

const TIER_TONE = { 1: 'danger', 2: 'accent' } as const;

function OutcomeBand({ side, outcome }: { side: 'yes' | 'no'; outcome: Outcome }) {
  const { t, tx } = useTranslation();
  return (
    <p className={`au-l-${side === 'yes' ? 'success' : 'neutral'} au-${side} flex min-w-0 flex-col gap-0.5 rounded-r-input py-1 pl-3 pr-2`} data-testid={`ask-${side}-band`}>
      <span className={`${side === 'yes' ? 'au-ink-lamp' : 'text-foreground'} typo-label`}>{tx(t.monitor.dc_deck_if_you, { verb: outcome.verb })}</span>
      <span className="line-clamp-2 min-w-0 typo-body text-foreground [text-wrap:pretty]">{outcome.effect}</span>
    </p>
  );
}

export function AskHead({ kind, tier, title, context, body, outcomes, stacked = true, aside }: {
  /** The kind word: Review, Question. */
  kind: string;
  tier: 1 | 2;
  title: string;
  context: ReactNode;
  body?: string | null;
  outcomes: readonly [Outcome, Outcome];
  /** Stack the pair (a rail) or set it side by side (a wide card). */
  stacked?: boolean;
  /** Right end of the eyebrow line (the rail's n of N walk). */
  aside?: ReactNode;
}) {
  const { t } = useTranslation();
  const m = t.monitor;
  const tierWord = tier === 1 ? m.dc_hub_tier_blocking : m.dc_hub_tier_decide;
  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid="ask-head">
      <span className="flex min-h-5 items-center gap-2">
        <span className="typo-eyebrow text-primary">{m.dc_hub_chip_gates}</span>
        <span className="typo-eyebrow text-foreground" aria-hidden>·</span>
        <span className="typo-eyebrow text-foreground">{kind}</span>
        <Tooltip content={tierWord}>
          <span className="inline-flex items-center pl-0.5" tabIndex={0} aria-label={tierWord}>
            <Lamp tone={TIER_TONE[tier]} breathe={tier === 1} />
          </span>
        </Tooltip>
        {aside && <span className="ml-auto flex items-center gap-0.5">{aside}</span>}
      </span>
      <span className="line-clamp-2 typo-heading text-foreground [text-wrap:balance]">{title}</span>
      <span className="truncate typo-caption">{context}</span>
      {/* The ask's own words, when the rail has the height for them (the head and dock must stay on screen). */}
      {body && <span className="hidden typo-body text-foreground [@media(min-height:880px)]:line-clamp-2">{body}</span>}
      <div className={`mt-1 grid gap-1.5 ${stacked ? 'grid-cols-1' : 'grid-cols-2'}`}>
        <OutcomeBand side="yes" outcome={outcomes[0]} />
        <OutcomeBand side="no" outcome={outcomes[1]} />
      </div>
    </div>
  );
}
