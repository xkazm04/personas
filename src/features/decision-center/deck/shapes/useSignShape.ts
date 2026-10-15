/**
 * The Sign card's state and verbs: the draft envelope (from the mandate's
 * stored one), the edit mode (`E`), the cap field, and sign / drop.
 *
 * Sign (`A`) signs the envelope exactly as the card shows it. When the draft
 * grants a merge or a spend the first press ARMS (the body lists the grants)
 * and the second press or Enter signs; any edit after arming disarms, so what
 * is confirmed is what was listed. Drop (`X`) opens the drop reason prompt.
 *
 * A re-read card (`payload.reread`) is a signed mandate asking to be read
 * again: `A` keeps it as signed while the draft equals the stored envelope,
 * and signs the change (arming the same way) once the operator edited it.
 * There is no drop: `X` is inert there.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MandateSignInput } from '@/lib/bindings/MandateSignInput';
import type { MandateReread } from '@/lib/bindings/MandateReread';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import type { DecisionItem } from '../../model/decisionModel';
import { applySuggestion, draftFrom, grantsOf, sameEnvelope, type EnvelopeGrant } from '../../mandate/envelope';
import type { DeckController } from '../useDeck';

export interface SignShape {
  /** The envelope as it would be signed; null while the mandate is unread. */
  envelope: MandateSignInput | null;
  draft: MandateSignInput | null;
  setDraft: (d: MandateSignInput) => void;
  /** The monthly cap field; null = no cap. */
  cap: number | null;
  setCap: (usd: number | null) => void;
  editing: boolean;
  toggleEdit: () => void;
  grants: EnvelopeGrant[];
  /** The first press armed the signature: the grants are listed, the next press signs. */
  armed: boolean;
  /** The re-read code when this card is a re-read of a signed mandate, else null. */
  reread: string | null;
  /** The re-read's figures and suggestion (from the mandate), on a re-read card. */
  rereadInfo: MandateReread | null;
  /** The draft differs from the stored envelope (a re-read then signs instead of keeping). */
  changed: boolean;
  sign: () => void;
  drop: () => void;
}

export function useSignShape(active: boolean, item: DecisionItem | undefined, mandate: MandateSummary | null, deck: DeckController): SignShape {
  const [draft, setDraftState] = useState<MandateSignInput | null>(null);
  const [cap, setCapState] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const loaded = !!mandate;

  // A new card, or its mandate arriving, starts from the stored envelope.
  useEffect(() => {
    setDraftState(active && mandate ? draftFrom(mandate.envelope) : null);
    setCapState(mandate?.envelope.budgetMonthlyUsd ?? null);
    setEditing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset per card and on first load only, never on a list re-read
  }, [active, item?.id, loaded]);

  const { setArmed } = deck;
  const setDraft = useCallback((d: MandateSignInput) => { setDraftState(d); setArmed(null); }, [setArmed]);
  const setCap = useCallback((usd: number | null) => { setCapState(usd); setArmed(null); }, [setArmed]);

  const envelope = useMemo(() => (draft ? { ...draft, budgetMonthlyUsd: cap } : null), [draft, cap]);
  const reread = active ? item?.payload?.reread ?? null : null;
  const rereadInfo = reread ? mandate?.reread ?? null : null;
  const changed = !!(envelope && mandate && !sameEnvelope(envelope, draftFrom(mandate.envelope)));
  // A re-read kept as signed grants nothing new: only a CHANGED envelope arms.
  const grants = useMemo(() => (envelope && (!reread || changed) ? grantsOf(envelope) : []), [envelope, reread, changed]);

  const sign = useCallback(() => {
    if (!active || !envelope) return;
    if (reread && !changed) { deck.decide({ verdict: 'accept' }, 'accept'); return; }
    if (grants.length > 0 && deck.armed !== 'accept') { deck.setArmed('accept'); return; }
    deck.decide({ verdict: 'accept', envelope }, 'accept');
  }, [active, envelope, reread, changed, grants.length, deck]);

  const drop = useCallback(() => {
    if (!active || !item || reread) return;
    const p = item.reasonPrompts?.find((r) => r.on === 'reject');
    if (p) deck.setPrompt(p);
    else deck.decide({ verdict: 'reject' }, 'reject');
  }, [active, item, reread, deck]);

  return {
    envelope, draft, setDraft, cap, setCap, editing,
    // On a re-read, the first edit opens with the suggestion applied: the
    // change it proposes is one key away, and still shown before it is signed.
    toggleEdit: () => {
      if (!editing && !changed && draft && rereadInfo?.suggest) setDraft(applySuggestion(draft, rereadInfo.suggest));
      setEditing((e) => !e);
    },
    grants, armed: active && deck.armed === 'accept', reread, rereadInfo, changed, sign, drop,
  };
}
