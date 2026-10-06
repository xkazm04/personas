/**
 * The dock — the well's foot, where every action of the card lives with its
 * key inset INSIDE the button (the only place a key is printed). One layout
 * for all four types; only the verbs differ:
 *   row 1  the verdict pair: yes is a solid lit slab, no is glass
 *   then   the item's branches, full width, digit-keyed, with their hint
 *   last   later, quiet
 * An armed verdict says so in place ("↵ to confirm"); a reject that wants a
 * reason swaps the dock for the reason prompt.
 */
import type { ReactNode } from 'react';
import { MessageCircle, SkipForward, Star } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import type { DecisionItem } from '../../../model/decisionModel';
import type { DeckActions } from './useDeckActions';
import type { DeckController } from './useDeck';
import { Key } from './Key';
import { ReasonPrompt } from './ReasonPrompt';
import { focusComposer } from './keys';

type Look = 'yes' | 'no' | 'branch' | 'plain';

function DockButton({ k, label, look, say, icon, armed, hint, onClick }: {
  k: string; label: string; look: Look; say?: string; icon?: ReactNode; armed?: boolean; hint?: string; onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="md"
      block
      onClick={onClick}
      aria-label={hint ? `${label} — ${hint}` : label}
      className="r2a-verdict r2a-btn"
      data-look={look}
      data-armed={armed || undefined}
      data-r2a-say={say}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {icon}
        <span className="flex min-w-0 flex-1 flex-col text-left">
          <span className="typo-heading">{armed ? '↵ to confirm' : label}</span>
          {hint && !armed && <span className="typo-caption">{hint}</span>}
        </span>
      </span>
      <Key>{k}</Key>
    </Button>
  );
}

function Rating({ value, onRate }: { value: number | null; onRate: (n: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-2" role="radiogroup" aria-label="Rate this report">
      <span className="flex items-center gap-1.5 typo-label">Rate <Key>⇧1-5</Key></span>
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

function Pair({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

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
  const skip = (
    <Button variant="ghost" size="sm" onClick={act.skip} icon={<SkipForward className="h-3.5 w-3.5" aria-hidden />} className="r2a-later r2a-btn">
      {v.skip} <Key>S</Key>
    </Button>
  );

  if (act.type === 'chat') {
    return (
      <>
        <Pair>
          <DockButton k="Space" label="Reply" look="yes" say="info" onClick={() => focusComposer(item.id)} />
          <DockButton k="D" label="Done" look="no" say="success" onClick={act.done} />
        </Pair>
        {skip}
      </>
    );
  }
  if (act.type === 'report' && item.kind === 'report') {
    return (
      <>
        <Rating value={rating} onRate={onRate} />
        <DockButton k="D" label="Done — mark read" look="yes" say="success" onClick={act.done} />
        {item.branches.map((b, i) => (
          <DockButton key={b.id} k={String(i + 1)} label={b.label} look="branch" icon={<MessageCircle className="h-4 w-4 flex-shrink-0" aria-hidden />} onClick={() => act.branch(i + 1)} />
        ))}
        {skip}
      </>
    );
  }
  const council = item.kind === 'council';
  return (
    <>
      <Pair>
        <DockButton k={council ? 'A ↵' : 'A'} label={v.accept} look="yes" say="success" armed={deck.armed === 'accept'} onClick={act.accept} />
        <DockButton k="R" label={v.reject} look="no" say="danger" armed={deck.armed === 'reject'} onClick={act.reject} />
      </Pair>
      {council && <span className="typo-caption">Approve arms it, ↵ confirms. Sending back needs a reason of 12+ characters.</span>}
      {item.branches.map((b, i) => (
        <DockButton key={b.id} k={String(i + 1)} label={b.label} look={b.tone === 'accent' ? 'branch' : 'plain'} hint={b.hint} onClick={() => act.branch(i + 1)} />
      ))}
      {skip}
    </>
  );
}
