/**
 * One turn at the table, as state: the hand it was dealt, which card is
 * picked, what is in the composer, and the single verdict the turn is allowed
 * to produce.
 *
 * It lives apart from `TablePlay` because it is the only part of the table
 * that is not layout — every rule about what may be answered, and when, is
 * here, and `TablePlay` is then just where the cards are placed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toastCatch } from '@/lib/silentCatch';
import type { SetupSessionApi, SetupSuggestion } from '../../../setup/setupContract';
import type { TableVerdict } from '../cardMotion';
import { tableKeyHandler } from './tableKeys';

const SCOPE = 'features/plugins/twin/experience/table/useTableTurn';

export interface TableTurn {
  /** The table's own focus root: it owns the keyboard. */
  rootRef: React.RefObject<HTMLDivElement | null>;
  cards: SetupSuggestion[];
  picked: number;
  setPicked: (index: number) => void;
  draft: string;
  setDraft: (value: string) => void;
  verdict: TableVerdict;
  play: (text: string) => void;
  onKeyDown: ReturnType<typeof tableKeyHandler>;
}

export function useTableTurn(session: SetupSessionApi): TableTurn {
  const rootRef = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState(0);
  const [draft, setDraft] = useState('');
  const [verdict, setVerdict] = useState<TableVerdict>(null);

  const cards = useMemo(
    () => (session.answerMode === 'write' ? [] : session.suggestions.slice(0, 3)),
    [session.answerMode, session.suggestions],
  );

  useEffect(() => {
    setPicked(0);
    setVerdict(null);
  }, [session.question]);
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  // One verdict per question. `session.busy` cannot be the guard: in the
  // training stage the answer is recorded BEFORE the next turn is requested,
  // so a second click (or a double-click landing on a card that is already
  // flying out, whose props are frozen) would still read "not busy" and send
  // the same answer twice. `undefined` means nothing has been answered yet.
  const answeredFor = useRef<string | null | undefined>(undefined);
  const claim = useCallback(() => {
    if (session.busy || answeredFor.current === session.question) return false;
    answeredFor.current = session.question;
    return true;
  }, [session.busy, session.question]);
  // A failed turn keeps the same question on the table; the guide being down
  // must not also lock the person out of answering it again.
  useEffect(() => {
    if (session.generatorError) answeredFor.current = undefined;
  }, [session.generatorError]);

  const play = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !claim()) return;
      setVerdict('played');
      setDraft('');
      session.answer(trimmed).catch(toastCatch(`${SCOPE}:answer`));
    },
    [session, claim],
  );
  const skip = useCallback(() => {
    if (!session.question || !claim()) return;
    setVerdict('skipped');
    session.skip().catch(toastCatch(`${SCOPE}:skip`));
  }, [session, claim]);
  const edit = useCallback(
    (index: number) => {
      const card = cards[index];
      if (!card) return;
      setDraft(card.text);
      rootRef.current?.querySelector<HTMLTextAreaElement>('[data-testid="xo-composer"]')?.focus();
    },
    [cards],
  );

  const onKeyDown = tableKeyHandler({
    count: cards.length,
    picked,
    setPicked,
    play: (i) => {
      const card = cards[i];
      if (card) play(card.text);
    },
    edit,
    skip,
  });

  return { rootRef, cards, picked, setPicked, draft, setDraft, verdict, play, onKeyDown };
}
