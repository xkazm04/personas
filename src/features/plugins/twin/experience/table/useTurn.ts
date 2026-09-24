/**
 * One turn of the lane: what is picked, what is drafted, and the two rules
 * that keep a turn honest.
 *
 * RULE ONE — one verdict per question. `session.busy` cannot be the guard: in
 * the training stage the answer is recorded BEFORE the next turn is requested,
 * so a second press (or a press landing on a card that is already leaving,
 * whose props are frozen) would still read "not busy" and send the same answer
 * twice. The claim is keyed on the question itself; `undefined` means nothing
 * has been answered yet. A failed turn keeps the same question on the table, so
 * the guide being down must not also lock the person out of answering it.
 *
 * RULE TWO — a redeal is PARKED, never fired inline. `setStage` and `setTopic`
 * only change what the next question is about, and `redeal` reads the session
 * after the render that carries the change; a redeal fired mid-turn is dropped
 * and the answer to the old turn lands on the new stage. So the request waits
 * here until nothing is in flight.
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

  // Rule two: park the request, fire it once the session is idle.
  const wantsDeal = useRef(false);
  const { stage, topic, busy, redeal, setStage, setTopic } = session;
  useEffect(() => {
    if (!wantsDeal.current || busy) return;
    wantsDeal.current = false;
    redeal();
  }, [stage, topic, busy, redeal]);

  const chooseStage = useCallback(
    (next: SetupStage) => {
      if (next === stage) return;
      wantsDeal.current = true;
      setStage(next);
    },
    [stage, setStage],
  );

  const chooseTopic = useCallback(
    (prompt: string, presetId: string) => {
      // The same topic again changes nothing the effect watches, so a parked
      // request would wait for the NEXT turn to settle and replace it. The
      // session already holds this topic: deal now.
      if (topic === prompt) {
        redeal();
        return;
      }
      wantsDeal.current = true;
      setTopic(prompt, presetId);
    },
    [topic, redeal, setTopic],
  );

  return { picked, setPicked, draft, setDraft, verdict, play, skip, chooseStage, chooseTopic };
}
