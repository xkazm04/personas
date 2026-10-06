/** The deck's compact key legend — the keys this card type answers to, in grammar order. */
import { Fragment } from 'react';
import { Kbd } from '@/features/shared/triage/triageFocusBridge';
import type { DecisionModalType } from '../../../model/decisionModel';

type Entry = [keys: string[], label: string];

const WALK: Entry = [['←', '→'], 'walk'];
const SCROLL: Entry = [['↑', '↓'], 'scroll'];
const BACK: Entry = [['Esc'], 'back'];

const BY_TYPE: Record<DecisionModalType, Entry[]> = {
  approval: [WALK, SCROLL, [['A'], 'approve'], [['R'], 'reject'], [['S'], 'skip'], [['1-9'], 'branch'], BACK],
  backlog: [WALK, SCROLL, [['A'], 'accept'], [['R'], 'reject'], [['1'], 'build now'], [['S'], 'skip'], BACK],
  report: [WALK, SCROLL, [['D'], 'done'], [['1'], 'follow up'], [['⇧1-5'], 'rate'], [['S'], 'skip'], BACK],
  chat: [WALK, SCROLL, [['Space'], 'reply'], [['↵'], 'send'], [['D'], 'done'], [['S'], 'skip'], BACK],
};

const COUNCIL: Entry[] = [WALK, SCROLL, [['A', '↵'], 'approve'], [['R'], 'send back'], [['S'], 'skip'], BACK];

/** The spine verbs read as the card names them (Resolve / Dismiss on an incident, Install on a promotion). */
function relabel(entries: Entry[], labels?: { accept: string; reject: string }): Entry[] {
  if (!labels) return entries;
  return entries.map(([keys, label]): Entry => [keys, label === 'approve' || label === 'accept' ? labels.accept.toLowerCase() : label === 'reject' ? labels.reject.toLowerCase() : label]);
}

export function KeyLegend({ type, isCouncil, labels }: { type: DecisionModalType; isCouncil: boolean; labels?: { accept: string; reject: string } }) {
  const entries = relabel(isCouncil ? COUNCIL : BY_TYPE[type], type === 'approval' || type === 'backlog' ? labels : undefined);
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 rounded-card border border-primary/10 bg-background px-4 py-2 typo-caption" data-testid="p2-key-legend">
      {entries.map(([keys, label]) => (
        <span key={label} className="flex items-center gap-1">
          {keys.map((k) => <Fragment key={k}><Kbd>{k}</Kbd></Fragment>)}
          <span className="text-foreground">{label}</span>
        </span>
      ))}
    </div>
  );
}
