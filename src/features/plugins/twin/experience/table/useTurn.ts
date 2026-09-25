/**
 * One turn of the lane: what is picked, what is drafted, and the two rules
 * that keep a turn honest.
 *
 * RULE ONE — one verdict per question. `session.busy` cannot be the guard: in
 * the persisted session the next question is already queued, so answering
 * never makes the table busy, and a second press (or a press landing on a card
 * that is already leaving, whose props are frozen) would send the same answer
 * twice. The server also accepts an answer only for the live step id — this is
 * defence in depth, not the only guard. The claim is keyed on the question
 * itself; `undefined` means nothing has been answered yet. A failed turn keeps
 * the same question on the table, so the guide being down must not also lock
 * the person out of answering it.
 *
 * RULE TWO — changing what the table is about is ONE instruction. The server
 * owns the queue and re-targets it on a stage or topic change, so there is no
 * parked redeal any more (the old one existed because `setStage`/`setTopic`
 * only changed what the NEXT question would be about). Whether the stage
 * actually differs is decided by the session against the STORED stage, which
 * this hook cannot see before the first snapshot lands.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { toastCatch } from '@/lib/silentCatch';
import type { SetupSessionApi, SetupStage } from '../../setup/setupContract';

const SCOPE = 'features/plugins/twin/experience/stage/useTurn';

/** What just happened to the question leaving the frame. */
export type TurnVerdict = 'played' | 'skipped' | null;

export interface Turn {
  picked: number;
  setPicked: (index: number) => void;
  draft: string;
  setDraft: (value: string) => void;
  verdict: TurnVerdict;
  play: (text: string) => void;
  skip: () => void;
  chooseStage: (next: SetupStage) => void;
  chooseTopic: (prompt: string, presetId: string) => void;
}

export function useTurn(session: SetupSessionApi): Turn {
  const [picked, setPicked] = useState(0);
  const [draft, setDraft] = useState('');
  const [verdict, setVerdict] = useState<TurnVerdict>(null);

  useEffect(() => {
    setPicked(0);
    setVerdict(null);
  }, [session.question]);

  const answeredFor = useRef<string | null | undefined>(undefined);
  const claim = useCallback(() => {
    if (session.busy || answeredFor.current === session.question) return false;
    answeredFor.current = session.question;
    return true;
  }, [session.busy, session.question]);
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

  const { setStage, setTopic } = session;
  const chooseStage = useCallback((next: SetupStage) => setStage(next), [setStage]);
  const chooseTopic = useCallback(
    (prompt: string, presetId: string) => setTopic(prompt, presetId),
    [setTopic],
  );

  return { picked, setPicked, draft, setDraft, verdict, play, skip, chooseStage, chooseTopic };
}
