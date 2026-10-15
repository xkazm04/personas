/**
 * The Sign card's dock: Sign (`A`, arms when the envelope grants merge or
 * spend) over Drop (`X`), Edit (`E`), Later (`S`). Armed, the Sign verb keeps
 * its name and prints the confirm key (the grants it confirms are listed in
 * the body, where there is room for them); Drop swaps the dock for its reason
 * prompt.
 *
 * A re-read card (a signed mandate asking to be read again) has no Drop: its
 * yes is Keep as signed until the operator edits the envelope, then Sign the
 * change.
 */
import { Check, PenLine, X } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { DecisionItem } from '../../model/decisionModel';
import { Branch, Later, Verdict } from '../DeckDock';
import { Keycap } from '../parts';
import { ReasonPrompt } from '../ReasonPrompt';
import type { DeckActions } from '../useDeckActions';
import type { DeckController } from '../useDeck';
import type { SignShape } from './useSignShape';

/** The yes verb. Unlike the shared verdict it keeps its own name when armed. */
function SignVerb({ label, armed, onClick }: { label: string; armed: boolean; onClick: () => void }) {
  const { t, tx } = useTranslation();
  return (
    <Button
      variant="ghost"
      size="md"
      block
      onClick={onClick}
      aria-label={armed ? tx(t.monitor.dc_deck_confirm_aria, { label }) : label}
      aria-keyshortcuts={armed ? 'Enter A' : 'A'}
      data-armed={armed ? '' : undefined}
      data-testid="sign-verb"
      className="au-verdict au-verdict-yes au-sheen au-lift au-l-success au-ink-lamp min-w-0 justify-start! rounded-input px-3! hover:bg-transparent [&>span:last-child]:flex [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1 [&>span:last-child]:items-center [&>span:last-child]:gap-2"
      icon={<Check className="h-4 w-4" strokeWidth={2.5} aria-hidden />}
    >
      <span className="min-w-0 flex-1 text-left typo-heading">{label}</span>
      <Keycap>{armed ? '↵' : 'A'}</Keycap>
    </Button>
  );
}

export function SignDock({ item, deck, act, sign }: { item: DecisionItem; deck: DeckController; act: DeckActions; sign: SignShape }) {
  const { t } = useTranslation();
  const m = t.monitor;
  if (deck.prompt) {
    return <ReasonPrompt prompt={deck.prompt} min={0} onSubmit={act.submitReason} onCancel={() => deck.setPrompt(null)} />;
  }
  const v = item.verdictLabels;
  const label = sign.reread ? (sign.changed ? m.ml_reread_sign_change : m.ml_reread_keep) : v.accept;
  return (
    <>
      <div className="grid grid-cols-1 gap-2">
        <SignVerb label={label} armed={sign.armed} onClick={act.accept} />
        {!sign.reread && (
          <Verdict k="X" label={v.reject} yes={false} tone="danger" icon={<X className="h-4 w-4" strokeWidth={2.5} aria-hidden />} onClick={sign.drop} />
        )}
      </div>
      <Branch k="E" label={sign.editing ? m.ml_sign_edit_done : sign.rereadInfo?.suggest && !sign.changed ? m.ml_reread_edit_suggest : m.ml_sign_edit} icon={<PenLine className="h-4 w-4" aria-hidden />} onClick={sign.toggleEdit} />
      <Later label={v.skip} onSkip={act.skip} />
    </>
  );
}
