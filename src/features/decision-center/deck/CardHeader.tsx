/**
 * The card's head — one anatomy for all four types, read top-down in the
 * modal's 5-second order:
 *   tile + eyebrow   the kind as a lit glyph; "GATES · REVIEW" said once; the
 *                    tier as a lamp (its words in a tooltip). Severity is a
 *                    WORD only on incidents, where it is the decision's subject.
 *   title            the ask — up to two balanced lines, never cut.
 *   context          one line: the tier in words and who raised it.
 *   outcome pair     "If you approve: ..." lit beside "If you reject: ..."
 *                    quiet, so both verdicts are read before either is
 *                    pressed. No key here: the key is printed once, inside
 *                    the verdict button. A lane shape whose dock offers other
 *                    verbs passes its own lines (`outcomes`, one per verb in
 *                    the dock's order); the first is lit, the rest quiet.
 */
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { TONE_TEXT } from './tones';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { chipOf, type DecisionItem } from '../model/decisionModel';
import { KIND_ICON, TIER_TONE, chipLabel, kindLabel, tierLabel, tierOf } from './deckMeta';
import { contextLine, outcomePair, type Outcome, type Outcomes } from './outcome';
import { Lamp } from './parts';

const SEVERITY_TONE = { critical: 'danger', high: 'danger', medium: 'warning', low: 'neutral' } as const;

const OUTCOME_COLS: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3' };

function OutcomeBand({ side, tone, outcome }: { side: 'yes' | 'no'; tone: string; outcome: Outcome }) {
  const { t, tx } = useTranslation();
  return (
    <p className={`au-l-${tone} au-${side} flex min-w-0 flex-col gap-0.5 rounded-r-input py-1.5 pl-3 pr-3`} data-testid={`deck-${side}-band`} data-verb={outcome.verb}>
      <span className={`${side === 'yes' ? 'au-ink-lamp' : 'text-foreground'} typo-label`}>{tx(t.monitor.dc_deck_if_you, { verb: outcome.verb })}</span>
      <span className="min-w-0 typo-body text-foreground [text-wrap:pretty]">{outcome.effect}</span>
    </p>
  );
}

export function CardHeader({ item, titleId, outcomes }: { item: DecisionItem; titleId: string; outcomes?: Outcomes }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const lines = outcomes ?? outcomePair(m, tx, item);
  const tier = tierOf(item);
  const tierWord = tierLabel(m, tier);
  const Icon = KIND_ICON[item.kind];
  const sev = item.kind === 'incident' && item.severity ? item.severity.toLowerCase() : null;
  const sevTone = sev ? SEVERITY_TONE[sev as keyof typeof SEVERITY_TONE] ?? 'warning' : null;
  // The source states severity as a machine token; the word is the catalog's.
  const sevLabel = sev ? tokenLabel(t, 'severity', sev) : null;
  const lampTip = item.alert ? `${tierWord}: ${item.alert.label}` : tierWord;
  return (
    <header className="relative z-[1] grid flex-shrink-0 grid-cols-[auto_1fr] gap-x-4 pb-4 pl-7 pr-4 pt-3">
      <span className="au-tile row-span-4 flex h-12 w-12 items-center justify-center rounded-card" aria-hidden>
        <Icon className="h-6 w-6" />
      </span>
      <div className="flex min-h-6 items-center gap-2.5 pr-2">
        <span className="au-ink-tone typo-eyebrow">{chipLabel(m, chipOf(item.kind))}</span>
        <span className="typo-eyebrow text-foreground" aria-hidden>·</span>
        <span className="typo-eyebrow text-foreground">{kindLabel(m, item.kind)}</span>
        <Tooltip content={lampTip}>
          <span className="inline-flex items-center gap-1.5 pl-1" tabIndex={0} aria-label={lampTip}>
            <Lamp tone={TIER_TONE[tier]} breathe={tier === 1} />
          </span>
        </Tooltip>
        {sevLabel && sevTone && <span className={`typo-eyebrow ${TONE_TEXT[sevTone]}`}>{sevLabel}</span>}
      </div>
      <h2 id={titleId} className="typo-heading-lg mt-1 line-clamp-2 max-w-[56ch] text-foreground [text-wrap:balance]">{item.title}</h2>
      <p className="mt-1 line-clamp-1 typo-body text-foreground" data-testid="deck-context">{contextLine(m, tx, item)}</p>
      <div className={`mt-3 grid max-w-[92ch] ${OUTCOME_COLS[lines.length] ?? 'grid-cols-2'} gap-3`} data-testid="deck-outcomes">
        {lines.map((o, i) => (
          <OutcomeBand key={`${i}:${o.verb}`} side={i === 0 ? 'yes' : 'no'} tone={i === 0 ? item.alert?.tone ?? 'success' : 'neutral'} outcome={o} />
        ))}
      </div>
      <span className="au-divider absolute bottom-0 left-7 right-0 h-px" aria-hidden />
    </header>
  );
}
