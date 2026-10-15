/**
 * The Sign card's dock: Sign (`A`, arms when the envelope grants merge or
 * spend) over Drop (`X`), Edit (`E`), Later (`S`). An armed signature lists
 * exactly what it grants before the second press; Drop swaps the dock for
 * its reason prompt.
 */
import { Check, Lock, PenLine, X } from 'lucide-react';
import { mergeLabel } from '@/features/fleet/monitor/grid/prototype/entry-e/mandate/mandateCopy';
import { useTranslation } from '@/i18n/useTranslation';
import type { MandateSignInput } from '@/lib/bindings/MandateSignInput';
import type { DecisionItem } from '../../model/decisionModel';
import type { EnvelopeGrant } from '../../mandate/envelope';
import { Branch, Later, Verdict } from '../DeckDock';
import { Keycap } from '../parts';
import { ReasonPrompt } from '../ReasonPrompt';
import type { DeckActions } from '../useDeckActions';
import type { DeckController } from '../useDeck';
import { useUsd } from './SignParts';
import type { SignShape } from './useSignShape';

function GrantsBox({ grants, envelope }: { grants: EnvelopeGrant[]; envelope: MandateSignInput }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const usd = useUsd();
  return (
    <div className="au-armed au-l-danger flex flex-col gap-1.5 rounded-input px-3 py-2.5" role="alert" data-testid="sign-grants-box">
      <span className="au-ink-lamp flex items-center gap-1.5 typo-eyebrow">
        <Lock className="h-3.5 w-3.5" aria-hidden />
        {m.ml_sign_grants}
      </span>
      {grants.map((g) => (
        <span key={g} className="typo-body text-foreground">
          {g === 'merge'
            ? tx(m.ml_sign_grant_merge, { policy: mergeLabel(m, envelope.mergePolicy) })
            : tx(m.ml_sign_grant_spend, { cap: usd(envelope.budgetMonthlyUsd ?? 0) })}
        </span>
      ))}
      <span className="flex items-center gap-1.5 typo-caption">
        <Keycap>Esc</Keycap> {m.dc_deck_armed_disarm}
      </span>
    </div>
  );
}

export function SignDock({ item, deck, act, sign }: { item: DecisionItem; deck: DeckController; act: DeckActions; sign: SignShape }) {
  const { t } = useTranslation();
  const m = t.monitor;
  if (deck.prompt) {
    return <ReasonPrompt prompt={deck.prompt} min={0} onSubmit={act.submitReason} onCancel={() => deck.setPrompt(null)} />;
  }
  const v = item.verdictLabels;
  const arms = sign.grants.length > 0;
  const armed = deck.armed === 'accept';
  return (
    <>
      {armed && sign.envelope && <GrantsBox grants={sign.grants} envelope={sign.envelope} />}
      <div className="grid grid-cols-1 gap-2">
        <Verdict k={arms ? 'A ↵' : 'A'} label={v.accept} yes tone="success" icon={<Check className="h-4 w-4" strokeWidth={2.5} aria-hidden />} armed={armed} onClick={act.accept} />
        <Verdict k="X" label={v.reject} yes={false} tone="danger" icon={<X className="h-4 w-4" strokeWidth={2.5} aria-hidden />} onClick={sign.drop} />
      </div>
      <Branch k="E" label={sign.editing ? m.ml_sign_edit_done : m.ml_sign_edit} icon={<PenLine className="h-4 w-4" aria-hidden />} onClick={sign.toggleEdit} />
      <Later label={v.skip} onSkip={act.skip} />
    </>
  );
}
