/**
 * The card's head — one anatomy for all four types, read top-down in the
 * modal's 5-second order:
 *   tile + eyebrow   the kind as a lit glyph; "GATES · REVIEW" said once; the
 *                    tier as a lamp (its words in a tooltip). Severity is a
 *                    WORD only on incidents, where it is the decision's subject.
 *   title            the ask — up to two balanced lines, never cut.
 *   consequence      "If you approve — <one sentence>". No key here: the key
 *                    is printed once, inside the verdict button.
 */
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { TONE_TEXT } from '@/features/agents/quick-answer/triage/deck/DeckChips';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { chipOf, modalTypeOf, type DecisionItem } from '../model/decisionModel';
import { KIND_ICON, TIER_TONE, chipLabel, kindLabel, tierLabel, tierOf, yesDoes, type Interpolate, type MonitorCopy } from './deckMeta';
import { Lamp } from './parts';

function yesLine(m: MonitorCopy, tx: Interpolate, item: DecisionItem): { verb: string; effect: string } {
  if (modalTypeOf(item.kind) === 'chat') return { verb: m.dc_deck_verb_reply, effect: yesDoes(m, tx, item) };
  if (item.kind === 'report') return { verb: m.dc_deck_verb_done, effect: yesDoes(m, tx, item) };
  return { verb: item.verdictLabels.accept.toLowerCase(), effect: yesDoes(m, tx, item) };
}

const SEVERITY_TONE = { critical: 'danger', high: 'danger', medium: 'warning', low: 'neutral' } as const;

export function CardHeader({ item, titleId }: { item: DecisionItem; titleId: string }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const tier = tierOf(item);
  const tierWord = tierLabel(m, tier);
  const Icon = KIND_ICON[item.kind];
  const yes = yesLine(m, tx, item);
  const sev = item.kind === 'incident' && item.severity ? item.severity.toLowerCase() : null;
  const sevTone = sev ? SEVERITY_TONE[sev as keyof typeof SEVERITY_TONE] ?? 'warning' : null;
  // The source states severity as a machine token; the word is the catalog's.
  const sevLabel = sev ? tokenLabel(t, 'severity', sev) : null;
  const lampTip = item.alert ? `${tierWord}: ${item.alert.label}` : tierWord;
  return (
    <header className="relative z-[1] grid flex-shrink-0 grid-cols-[auto_1fr] gap-x-4 pb-5 pl-7 pr-4 pt-3">
      <span className="au-tile row-span-3 flex h-12 w-12 items-center justify-center rounded-card" aria-hidden>
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
      <p className={`au-l-${item.alert?.tone ?? 'success'} au-yes mt-3 flex max-w-[78ch] items-baseline gap-2.5 rounded-r-input py-1.5 pl-3 pr-3`} data-testid="deck-yes-band">
        <span className="au-ink-lamp typo-label whitespace-nowrap">{tx(m.dc_deck_if_you, { verb: yes.verb })}</span>
        <span className="min-w-0 typo-body text-foreground">{yes.effect}</span>
      </p>
      <span className="au-divider absolute bottom-0 left-7 right-0 h-px" aria-hidden />
    </header>
  );
}
