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
import { TONE_TEXT } from '@/features/shared/triage/triageFocusBridge';
import { chipOf, modalTypeOf, type DecisionItem } from '../model/decisionModel';
import { CHIP_META, KIND_ICON, KIND_LABEL, TIER_META, tierOf, yesDoes } from './deckMeta';
import { Lamp } from './parts';

function yesLine(item: DecisionItem): { verb: string; effect: string } {
  const type = modalTypeOf(item.kind);
  if (type === 'chat') return { verb: 'reply', effect: `Your answer is posted to ${item.source.label}.` };
  if (item.kind === 'report') return { verb: 'mark it done', effect: 'It is marked read and leaves your queue.' };
  return { verb: item.verdictLabels.accept.toLowerCase(), effect: yesDoes(item) };
}

const SEVERITY_TONE = { critical: 'danger', high: 'danger', medium: 'warning', low: 'neutral' } as const;

export function CardHeader({ item, titleId }: { item: DecisionItem; titleId: string }) {
  const tier = tierOf(item);
  const meta = TIER_META[tier];
  const chip = CHIP_META[chipOf(item.kind)];
  const Icon = KIND_ICON[item.kind];
  const yes = yesLine(item);
  const sev = item.kind === 'incident' && item.severity ? item.severity.toLowerCase() : null;
  const sevTone = sev ? SEVERITY_TONE[sev as keyof typeof SEVERITY_TONE] ?? 'warning' : null;
  const lampTip = item.alert ? `${meta.label} — ${item.alert.label}` : meta.label;
  return (
    <header className="relative z-[1] grid flex-shrink-0 grid-cols-[auto_1fr] gap-x-4 pb-5 pl-7 pr-4 pt-3">
      <span className="au-tile row-span-3 flex h-12 w-12 items-center justify-center rounded-card" aria-hidden>
        <Icon className="h-6 w-6" />
      </span>
      <div className="flex min-h-6 items-center gap-2.5 pr-2">
        <span className="au-ink-tone typo-eyebrow">{chip.label}</span>
        <span className="typo-eyebrow text-foreground" aria-hidden>·</span>
        <span className="typo-eyebrow text-foreground">{KIND_LABEL[item.kind]}</span>
        <Tooltip content={lampTip}>
          <span className="inline-flex items-center gap-1.5 pl-1" tabIndex={0} aria-label={lampTip}>
            <Lamp tone={meta.tone} breathe={tier === 1} />
          </span>
        </Tooltip>
        {sev && sevTone && <span className={`typo-eyebrow ${TONE_TEXT[sevTone]}`}>{sev}</span>}
      </div>
      <h2 id={titleId} className="typo-heading-lg mt-1 line-clamp-2 max-w-[56ch] text-foreground [text-wrap:balance]">{item.title}</h2>
      <p className={`au-l-${item.alert?.tone ?? 'success'} au-yes mt-3 flex max-w-[78ch] items-baseline gap-2.5 rounded-r-input py-1.5 pl-3 pr-3`} data-testid="p2-yes-band">
        <span className="au-ink-lamp typo-label whitespace-nowrap">If you {yes.verb}</span>
        <span className="min-w-0 typo-body text-foreground">{yes.effect}</span>
      </p>
      <span className="au-divider absolute bottom-0 left-7 right-0 h-px" aria-hidden />
    </header>
  );
}
