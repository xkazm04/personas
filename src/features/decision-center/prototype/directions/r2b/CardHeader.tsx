/**
 * The card's head — one anatomy for all four types, built to pass the modal's
 * 5-second test top-down on the instrument grid:
 *   eyebrow  kind tile · KIND · lamp        (what kind of thing; how urgent)   … Keys
 *   title    the ask, up to two balanced lines
 *   rule     IF YOU <VERB>  | one sentence  (what happens if you say yes)
 * The kind word appears once; tier and severity are a lamp (the word only on
 * incidents, where severity is the subject); no key is printed here — it lives
 * on the verdict button.
 */
import type { CSSProperties, ReactNode } from 'react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { modalTypeOf, type DecisionItem } from '../../../model/decisionModel';
import { KIND_ICON, KIND_LABEL, LAMP_TONE, TIER_META, TIER_TONE, readMinutes, severityTag, tierOf, yesDoes } from './deckMeta';

function yesLine(item: DecisionItem): { verb: string; effect: string } {
  const type = modalTypeOf(item.kind);
  if (type === 'chat') return { verb: 'reply', effect: `Your answer is posted to ${item.source.label} and the thread leaves your queue.` };
  if (item.kind === 'report') return { verb: 'mark it done', effect: `It is filed as read — about ${readMinutes(item)} min to read.` };
  return { verb: item.verdictLabels.accept.toLowerCase(), effect: yesDoes(item) };
}

const ALERT_TONE = { neutral: 'var(--muted-foreground)', accent: 'var(--primary)', success: 'var(--status-success)', warning: 'var(--status-warning)', danger: 'var(--status-error)' } as const;

export function CardHeader({ item, titleId, keys }: { item: DecisionItem; titleId: string; keys: ReactNode }) {
  const tier = tierOf(item);
  const sev = severityTag(item);
  const Icon = KIND_ICON[item.kind];
  const yes = yesLine(item);
  const lamp = sev ? LAMP_TONE[sev.tone] : TIER_TONE[tier];
  const lampTip = [TIER_META[tier].label, sev ? `${sev.label} severity` : null, item.alert?.label ?? null].filter(Boolean).join(' · ');
  return (
    <header className="r2b-head">
      <div className="r2b-eyebrow">
        <span className="r2b-tile"><Icon className="h-4 w-4" aria-hidden /></span>
        <span className="r2b-kind typo-eyebrow">{KIND_LABEL[item.kind]}</span>
        <Tooltip content={lampTip}>
          <span className="r2b-tier" tabIndex={0} aria-label={lampTip}>
            <span className="r2b-tier-lamp" style={{ '--r2b-lamp': lamp } as CSSProperties} aria-hidden />
            {item.kind === 'incident' && sev && <span className="typo-label" style={{ color: lamp }}>{sev.label}</span>}
          </span>
        </Tooltip>
        {keys}
      </div>
      <h2 id={titleId} className="r2b-title">{item.title}</h2>
      <div className="r2b-yes" data-testid="r2b-yes-band" style={{ '--r2b-yes-tone': ALERT_TONE[item.alert?.tone ?? 'success'] } as CSSProperties}>
        <span className="r2b-yes-label typo-eyebrow">If you {yes.verb}</span>
        <span className="r2b-yes-text typo-body-lg">{yes.effect}</span>
      </div>
    </header>
  );
}
