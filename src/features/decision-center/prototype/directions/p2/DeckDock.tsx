/**
 * The dock — the rail's foot, where every action of the card lives with its
 * key printed on it. One layout for all four types; only the verbs differ:
 *   row 1  the yes / no pair, side by side (the two keys you will press most)
 *   then   the item's branches, full width, digit-keyed, with their hint
 *   last   skip, quiet
 * An armed verdict says so in place ("↵ to confirm"); a reject that wants a
 * reason swaps the dock for the reason prompt.
 */
import type { ReactNode } from 'react';
import { Check, MessageCircle, SkipForward, Star } from 'lucide-react';
import { Button, type ButtonTone } from '@/features/shared/components/buttons';
import { Kbd } from '@/features/shared/triage/triageFocusBridge';
import type { DecisionItem } from '../../../model/decisionModel';
import type { DeckActions } from './useDeckActions';
import type { DeckController } from './useDeck';
import { ReasonPrompt } from './ReasonPrompt';
import { focusComposer } from './keys';

function DockButton({ k, label, tone, icon, armed, hint, onClick }: {
  k: string; label: string; tone?: ButtonTone; icon?: ReactNode; armed?: boolean; hint?: string; onClick: () => void;
}) {
  return (
    <Button
      variant={tone ? 'accent' : 'secondary'}
      tone={tone}
      size="md"
      block
      onClick={onClick}
      aria-label={hint ? `${label} — ${hint}` : label}
      className={`min-w-0 justify-start! px-2.5! ${armed ? 'ring-2 ring-current' : ''} [&>span:last-child]:flex [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1 [&>span:last-child]:items-center [&>span:last-child]:gap-2`}
      icon={icon}
    >
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="line-clamp-2 w-full">{armed ? '↵ to confirm' : label}</span>
        {hint && !armed && <span className="block w-full truncate typo-caption">{hint}</span>}
      </span>
      <Kbd>{k}</Kbd>
    </Button>
  );
}

function Rating({ value, onRate }: { value: number | null; onRate: (n: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-2 px-1" role="radiogroup" aria-label="Rate this report">
      <span className="typo-label">Rate · ⇧1-5</span>
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
    <Button variant="ghost" size="sm" onClick={act.skip} icon={<SkipForward className="h-3.5 w-3.5" aria-hidden />} className="self-end">
      {v.skip} <Kbd>S</Kbd>
    </Button>
  );
  const check = <Check className="h-4 w-4" aria-hidden />;

  if (act.type === 'chat') {
    return (
      <>
        <Pair>
          <DockButton k="Space" label="Reply" tone="info" onClick={() => focusComposer(item.id)} />
          <DockButton k="D" label="Done" tone="success" onClick={act.done} />
        </Pair>
        {skip}
      </>
    );
  }
  if (act.type === 'report' && item.kind === 'report') {
    return (
      <>
        <Rating value={rating} onRate={onRate} />
        <DockButton k="D" label="Done — mark read" tone="success" icon={check} onClick={act.done} />
        {item.branches.map((b, i) => (
          <DockButton key={b.id} k={String(i + 1)} label={b.label} tone="info" icon={<MessageCircle className="h-4 w-4" aria-hidden />} onClick={() => act.branch(i + 1)} />
        ))}
        {skip}
      </>
    );
  }
  const council = item.kind === 'council';
  return (
    <>
      <Pair>
        <DockButton k={council ? 'A ↵' : 'A'} label={v.accept} tone="success" armed={deck.armed === 'accept'} onClick={act.accept} />
        <DockButton k="R" label={v.reject} tone="error" armed={deck.armed === 'reject'} onClick={act.reject} />
      </Pair>
      {council && <span className="px-1 typo-caption">Approve arms, ↵ confirms · Send back needs a 12+ character reason</span>}
      {item.branches.map((b, i) => (
        <DockButton key={b.id} k={String(i + 1)} label={b.label} tone={b.tone === 'accent' ? 'highlight' : undefined} hint={b.hint} onClick={() => act.branch(i + 1)} />
      ))}
      {skip}
    </>
  );
}
