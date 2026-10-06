/**
 * The dock — the rail's foot, where every action of the card lives, each with
 * its key set INSIDE the button (the only place a key is printed). One layout
 * for all four types; only the verbs differ:
 *   row 1  the yes / no pair: yes is the one solid control on the card
 *   then   the item's branches, hairline rows, digit-keyed, with their hint
 *   last   later, quiet
 * An armed verdict says so in place ("↵ confirm") and pulses; a reject
 * that wants a reason swaps the dock for the reason prompt.
 */
import type { ReactNode } from 'react';
import { Check, MessageCircle, SkipForward, Star, X } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Kbd } from '@/features/shared/triage/triageFocusBridge';
import type { DecisionItem } from '../../../model/decisionModel';
import type { DeckActions } from './useDeckActions';
import type { DeckController } from './useDeck';
import { ReasonPrompt } from './ReasonPrompt';
import { focusComposer } from './keys';

type ActKind = 'yes' | 'no' | 'info' | 'branch';

function Act({ k, label, kind, icon, armed, hint, accent, onClick }: {
  k: string; label: string; kind: ActKind; icon?: ReactNode; armed?: boolean; hint?: string; accent?: boolean; onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="md"
      onClick={onClick}
      aria-label={hint ? `${label} — ${hint}` : label}
      className="r2b-act"
      data-kind={kind}
      data-armed={armed || undefined}
      data-accent={accent || undefined}
    >
      {!armed && icon}
      <span className="r2b-act-label">
        <span className="block typo-body text-current">{armed ? '↵ confirm' : label}</span>
        {hint && !armed && <span className="r2b-act-hint typo-caption">{hint}</span>}
      </span>
      <span className="r2b-key typo-code">{<Kbd>{k}</Kbd>}</span>
    </Button>
  );
}

function Rating({ value, onRate }: { value: number | null; onRate: (n: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-2" role="radiogroup" aria-label="Rate this report">
      <span className="r2b-key flex items-center gap-1.5 typo-caption">Rate <Kbd>⇧1-5</Kbd></span>
      <span className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <Button key={n} variant="ghost" size="icon-sm" role="radio" aria-checked={value === n} aria-label={`${n} of 5`} onClick={() => onRate(n)}>
            <Star className={`h-4 w-4 ${value && n <= value ? 'fill-current text-status-warning' : 'text-muted-foreground'}`} aria-hidden />
          </Button>
        ))}
      </span>
    </div>
  );
}

const Pair = ({ children, stack }: { children: ReactNode; stack?: boolean }) => <div className="r2b-pair" data-stack={stack || undefined}>{children}</div>;

export function DeckDock({ item, deck, act, rating, onRate }: {
  item: DecisionItem;
  deck: DeckController;
  act: DeckActions;
  rating: number | null;
  onRate: (n: number) => void;
}) {
  if (deck.prompt) {
    return <ReasonPrompt prompt={deck.prompt} min={item.kind === 'council' ? 12 : 0} onSubmit={act.submitReason} onCancel={() => deck.setPrompt(null)} />;
  }
  const v = item.verdictLabels;
  const later = (
    <div className="r2b-later">
      <span />
      <Button variant="ghost" size="sm" onClick={act.skip} icon={<SkipForward className="h-3.5 w-3.5" aria-hidden />}>
        <span className="r2b-key inline-flex items-center gap-2">{v.skip} <Kbd>S</Kbd></span>
      </Button>
    </div>
  );
  const check = <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden />;

  if (act.type === 'chat') {
    return (
      <>
        <Pair>
          <Act k="Space" label="Reply" kind="info" icon={<MessageCircle className="h-4 w-4" aria-hidden />} onClick={() => focusComposer(item.id)} />
          <Act k="D" label="Done" kind="yes" icon={check} onClick={act.done} />
        </Pair>
        {later}
      </>
    );
  }
  if (act.type === 'report' && item.kind === 'report') {
    return (
      <>
        <Rating value={rating} onRate={onRate} />
        <Act k="D" label="Done — mark read" kind="yes" icon={check} onClick={act.done} />
        {item.branches.map((b, i) => (
          <Act key={b.id} k={String(i + 1)} label={b.label} kind="branch" accent icon={<MessageCircle className="h-4 w-4" aria-hidden />} onClick={() => act.branch(i + 1)} />
        ))}
        {later}
      </>
    );
  }
  const council = item.kind === 'council';
  return (
    <>
      <Pair stack={council}>
        <Act k={council ? 'A ↵' : 'A'} label={v.accept} kind="yes" icon={check} armed={deck.armed === 'accept'} onClick={act.accept} />
        <Act k="R" label={v.reject} kind="no" icon={<X className="h-4 w-4" strokeWidth={2.5} aria-hidden />} armed={deck.armed === 'reject'} onClick={act.reject} />
      </Pair>
      {council && <span className="r2b-note typo-caption">Approve arms, ↵ confirms. Send back needs a reason of 12+ characters.</span>}
      {item.branches.map((b, i) => (
        <Act key={b.id} k={String(i + 1)} label={b.label} kind="branch" accent={b.tone === 'accent'} hint={b.hint} onClick={() => act.branch(i + 1)} />
      ))}
      {later}
    </>
  );
}
