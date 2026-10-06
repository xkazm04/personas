/**
 * The card's head — one anatomy for all four types, built to pass the modal's
 * 5-second test top-down:
 *   tile + eyebrow   kind glyph (the card's light source) · KIND · tier lamp
 *   title            the ask, up to two balanced lines        (what is asked)
 *   consequence      "If you <verb> — <effect>", one sentence  (what yes does)
 * No key here: the key is printed once, inside the verdict button.
 * Severity is a WORD only where it is the decision's subject (incidents).
 */
import { CornerDownRight } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { modalTypeOf, type DecisionItem } from '../../../model/decisionModel';
import { KIND_ICON, KIND_LABEL, TIER_META, TIER_TIP, readMinutes, tierOf, yesDoes } from './deckMeta';

function yesLine(item: DecisionItem): { verb: string; effect: string } {
  const type = modalTypeOf(item.kind);
  if (type === 'chat') return { verb: 'reply', effect: `Your answer is posted to ${item.source.label}; Done closes it without a reply.` };
  if (item.kind === 'report') return { verb: 'mark it done', effect: `It leaves your reading queue — about ${readMinutes(item)} min to read.` };
  return { verb: item.verdictLabels.accept.toLowerCase(), effect: yesDoes(item) };
}

const SEVERITY_SAY: Record<string, string> = { critical: 'danger', high: 'danger', medium: 'warning', low: 'neutral' };

export function CardHeader({ item, titleId }: { item: DecisionItem; titleId: string }) {
  const tier = tierOf(item);
  const meta = TIER_META[tier];
  const Icon = KIND_ICON[item.kind];
  const yes = yesLine(item);
  const severity = item.kind === 'incident' && item.severity ? item.severity : null;
  const lampTip = item.alert ? `${TIER_TIP[tier]} · ${item.alert.label}` : TIER_TIP[tier];
  return (
    <header className="r2a-head">
      <span className="r2a-tile h-12 w-12"><Icon className="h-6 w-6" aria-hidden /></span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="typo-eyebrow r2a-tone">{KIND_LABEL[item.kind]}</span>
          {severity && (
            <>
              <span className="typo-caption" aria-hidden>·</span>
              <span className="typo-eyebrow r2a-say capitalize" data-r2a-say={SEVERITY_SAY[severity] ?? 'warning'}>{severity}</span>
            </>
          )}
          <Tooltip content={lampTip}>
            <span className="r2a-lamp ml-1" data-r2a-lamp={meta.tone} tabIndex={0} aria-label={lampTip} />
          </Tooltip>
        </div>
        <h2 id={titleId} className="r2a-title typo-heading-lg text-foreground">{item.title}</h2>
        <p className="r2a-yes" data-r2a-say={item.alert?.tone ?? 'success'} data-testid="r2a-yes-band">
          <CornerDownRight className="r2a-say h-4 w-4 flex-shrink-0" aria-hidden />
          <span className="typo-label r2a-say whitespace-nowrap">If you {yes.verb}</span>
          <span className="typo-body text-foreground">{yes.effect}</span>
        </p>
      </div>
    </header>
  );
}
