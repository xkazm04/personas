/**
 * The Sign card's state and verbs: the draft envelope (from the mandate's
 * stored one), the edit mode (`E`), the cap field, and sign / drop.
 *
 * Sign (`A`) signs the envelope exactly as the card shows it. When the draft
 * grants a merge or a spend the first press ARMS (the dock lists the grants)
 * and the second press or Enter signs; any edit after arming disarms, so what
 * is confirmed is what was listed. Drop (`X`) opens the drop reason prompt.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MandateSignInput } from '@/lib/bindings/MandateSignInput';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import type { DecisionItem } from '../../model/decisionModel';
import { draftFrom, grantsOf, type EnvelopeGrant } from '../../mandate/envelope';
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
  const grants = useMemo(() => (envelope ? grantsOf(envelope) : []), [envelope]);

  const sign = useCallback(() => {
    if (!active || !envelope) return;
    if (grants.length > 0 && deck.armed !== 'accept') { deck.setArmed('accept'); return; }
    deck.decide({ verdict: 'accept', envelope }, 'accept');
  }, [active, envelope, grants.length, deck]);

  const drop = useCallback(() => {
    if (!active || !item) return;
    const p = item.reasonPrompts?.find((r) => r.on === 'reject');
    if (p) deck.setPrompt(p);
    else deck.decide({ verdict: 'reject' }, 'reject');
  }, [active, item, deck]);

  return {
    envelope, draft, setDraft, cap, setCap, editing,
    toggleEdit: () => setEditing((e) => !e),
    grants, sign, drop,
  };
}
