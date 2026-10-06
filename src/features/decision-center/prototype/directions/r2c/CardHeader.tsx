/**
 * The card's head — one anatomy for all four types, built to pass the modal's
 * 5-second test top-down:
 *   eyebrow  chip · kind · tier          (what kind of thing this is)
 *   title    the ask, in one line        (what is being asked)
 *   band     "If you <verb>: <effect>"   (what happens if you say yes) + key
 */
import { Kbd } from '@/features/shared/triage/triageFocusBridge';
import { TONE_CHIP } from '@/features/agents/quick-answer/triage/deck/DeckChips';
import { chipOf, modalTypeOf, type DecisionItem } from '../../../model/decisionModel';
import { CHIP_META, KIND_LABEL, TIER_META, readMinutes, tierOf, yesDoes } from './deckMeta';

function yesLine(item: DecisionItem): { verb: string; key: string; effect: string } {
  const type = modalTypeOf(item.kind);
  if (type === 'chat') {
    return { verb: 'reply', key: 'Space', effect: `Your answer is posted to ${item.source.label}; D closes it without a reply.` };
  }
  if (item.kind === 'report') {
    return { verb: 'mark it done', key: 'D', effect: `About ${readMinutes(item)} min to read. Done marks it read; 1 follows up in chat.` };
  }
  return { verb: item.verdictLabels.accept.toLowerCase(), key: item.kind === 'council' ? 'A ↵' : 'A', effect: yesDoes(item) };
}

export function CardHeader({ item, titleId }: { item: DecisionItem; titleId: string }) {
  const tier = TIER_META[tierOf(item)];
  const chip = CHIP_META[chipOf(item.kind)];
  const yes = yesLine(item);
  const alertTone = item.alert?.tone ?? 'success';
  return (
    <header className="flex flex-col gap-3 border-b border-primary/10 px-6 pb-4 pt-5">
      <div className="flex items-center gap-2 typo-caption">
        <chip.icon className="h-4 w-4 text-primary" aria-hidden />
        <span className="typo-eyebrow text-primary">{chip.label}</span>
        <span aria-hidden>·</span>
        <span className="text-foreground">{KIND_LABEL[item.kind]}</span>
        <span className={`ml-1 rounded-pill border px-2 py-px typo-caption ${TONE_CHIP[tier.tone]}`}>{tier.label}</span>
        {item.alert && (
          <span className={`rounded-pill border px-2 py-px typo-caption ${TONE_CHIP[item.alert.tone]}`}>{item.alert.label}</span>
        )}
      </div>
      <h2 id={titleId} className="typo-heading-lg max-w-[60ch] text-foreground">{item.title}</h2>
      <div className={`flex items-center gap-3 rounded-input border px-3 py-2 ${TONE_CHIP[alertTone]}`} data-testid="p2-yes-band">
        <span className="typo-label whitespace-nowrap">If you {yes.verb}</span>
        <span className="min-w-0 flex-1 typo-body text-foreground">{yes.effect}</span>
        <Kbd>{yes.key}</Kbd>
      </div>
    </header>
  );
}
