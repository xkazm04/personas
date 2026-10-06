/**
 * The dock — the rail's foot, where every action of the card lives with its
 * key printed ONCE, inset in the button itself. One layout for all four types:
 *   row 1  the verdict pair (glyph + verb + key), the yes lit, the no quieter
 *   then   the item's branches, full width: their own words, a hint, a digit
 *   last   later, quiet
 * An armed verdict says so in place ("↵ to confirm") and glows; a reject that
 * wants a reason swaps the dock for the reason prompt.
 */
import type { ReactNode } from 'react';
import { Check, CornerDownRight, MessageCircle, Reply, SkipForward, Star, X } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import type { DecisionItem } from '../../../model/decisionModel';
import type { DeckActions } from './useDeckActions';
import type { DeckController } from './useDeck';
import { ReasonPrompt } from './ReasonPrompt';
import { focusComposer } from './keys';
import { Keycap } from './parts';

function Verdict({ k, label, yes, tone, icon, armed, onClick }: {
  k: string; label: string; yes: boolean; tone: 'success' | 'danger' | 'accent'; icon: ReactNode; armed?: boolean; onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="md"
      block
      onClick={onClick}
      aria-label={armed ? `${label} — press Enter to confirm` : label}
      data-armed={armed ? '' : undefined}
      className={`au-verdict au-sheen au-lift au-l-${tone} ${yes ? 'au-verdict-yes' : 'au-verdict-no'} au-ink-lamp min-w-0 justify-start! rounded-input px-3! hover:bg-transparent [&>span:last-child]:flex [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1 [&>span:last-child]:items-center [&>span:last-child]:gap-2`}
      icon={icon}
    >
      <span className="min-w-0 flex-1 text-left typo-heading">{armed ? '↵ to confirm' : label}</span>
      <Keycap>{k}</Keycap>
    </Button>
  );
}

function Branch({ k, label, hint, accent, icon, onClick }: { k: string; label: string; hint?: string; accent?: boolean; icon?: ReactNode; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="md"
      block
      onClick={onClick}
      aria-label={hint ? `${label} — ${hint}` : label}
      data-accent={accent ? '' : undefined}
      className={`au-branch au-sheen au-lift min-w-0 justify-start! rounded-input px-3! py-2! hover:bg-transparent ${accent ? 'text-primary' : 'text-foreground'} [&>span:last-child]:flex [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1 [&>span:last-child]:items-center [&>span:last-child]:gap-2`}
      icon={icon ?? <CornerDownRight className="h-4 w-4" aria-hidden />}
    >
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="typo-body [text-wrap:pretty]">{label}</span>
        {hint && <span className="typo-caption">{hint}</span>}
      </span>
      <Keycap>{k}</Keycap>
    </Button>
  );
}

function Rating({ value, onRate }: { value: number | null; onRate: (n: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-2 px-1" role="radiogroup" aria-label="Rate this report (Shift+1-5)">
      <span className="flex items-center gap-1.5 typo-eyebrow text-foreground">Rate <Keycap>⇧1-5</Keycap></span>
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
    <Button variant="ghost" size="sm" onClick={act.skip} icon={<SkipForward className="h-3.5 w-3.5" aria-hidden />} className="au-lift self-end [&>span:last-child]:inline-flex [&>span:last-child]:items-center [&>span:last-child]:gap-1.5">
      {v.skip} <Keycap>S</Keycap>
    </Button>
  );
  const check = <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden />;

  if (act.type === 'chat') {
    return (
      <>
        <div className="grid grid-cols-2 gap-2">
          <Verdict k="Space" label="Reply" yes tone="accent" icon={<Reply className="h-4 w-4" aria-hidden />} onClick={() => focusComposer(item.id)} />
          <Verdict k="D" label="Done" yes={false} tone="success" icon={check} onClick={act.done} />
        </div>
        {later}
      </>
    );
  }
  if (act.type === 'report' && item.kind === 'report') {
    return (
      <>
        <Rating value={rating} onRate={onRate} />
        <Verdict k="D" label="Done — mark read" yes tone="success" icon={check} onClick={act.done} />
        {item.branches.map((b, i) => (
          <Branch key={b.id} k={String(i + 1)} label={b.label} hint={b.hint} icon={<MessageCircle className="h-4 w-4" aria-hidden />} onClick={() => act.branch(i + 1)} />
        ))}
        {later}
      </>
    );
  }
  const council = item.kind === 'council';
  // The verbs keep their full words: a long pair (Send back + A ↵) stacks rather than wraps.
  const wide = council || v.accept.length + v.reject.length > 16;
  return (
    <>
      <div className={`grid gap-2 ${wide ? 'grid-cols-1' : 'grid-cols-2'}`}>
        <Verdict k={council ? 'A ↵' : 'A'} label={v.accept} yes tone="success" icon={check} armed={deck.armed === 'accept'} onClick={act.accept} />
        <Verdict k="R" label={v.reject} yes={false} tone="danger" icon={<X className="h-4 w-4" strokeWidth={2.5} aria-hidden />} armed={deck.armed === 'reject'} onClick={act.reject} />
      </div>
      {item.branches.map((b, i) => (
        <Branch key={b.id} k={String(i + 1)} label={b.label} hint={b.hint} accent={b.tone === 'accent'} onClick={() => act.branch(i + 1)} />
      ))}
      {later}
    </>
  );
}
