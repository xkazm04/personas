/**
 * The answer beat of the training overlay (spark twin-portable-blueprint).
 *
 * On an answer the hand lifts off the table, the blueprint underneath plays
 * what that answer changed (`instantDelta`) for about two seconds, and only
 * then is the next card dealt. Any key during the beat deals at once. When the
 * reconcile pass later scores the answer (`reconciledDelta`), the blueprint
 * animates the gain in place, around whatever card is up; because a card was
 * covering part of the drawing, that reconciled delta is replayed at the start
 * of the next lift before the new answer's own delta. Reduced motion: no
 * replay, and the beat shortens to 600 ms.
 *
 * The step being answered comes from the snapshot the blueprint read last.
 * When that read is a beat behind (the card changed faster than the read), the
 * delta is resolved from the transcript as soon as the next read carries the
 * answered step.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { SetupGoal } from '@/lib/bindings/SetupGoal';
import type { SetupStep } from '@/lib/bindings/SetupStep';
import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';

import type { TurnVerdict } from '../experience/table/useTurn';
import type { BlueprintDelta } from './blueprintContract';
import { instantDelta, reconciledDelta } from './blueprintDelta';

export const BEAT_MS = 2000;
export const BEAT_REDUCED_MS = 600;
export const REPLAY_MS = 900;

/** Keys that never deal early: leaving, moving focus, or a lone modifier. */
const PASSIVE_KEYS: ReadonlySet<string> = new Set(['Escape', 'Tab', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);

export interface AnswerBeatInput {
  /** The question on the table. */
  question: string | null;
  /** What happened to the question leaving the table (`useTurn`). */
  verdict: TurnVerdict;
  /** The live step as the blueprint's last snapshot read saw it. */
  liveStep: SetupStep | null;
  goals: readonly SetupGoal[];
  transcript: readonly SetupStep[];
  reduced: boolean;
}

export interface AnswerBeat {
  /** The hand is held off the table while the blueprint plays the delta. */
  holding: boolean;
  /** The delta the blueprint plays; it stays after the beat so its late phase can land in place. */
  delta: BlueprintDelta | null;
  /** End the beat now and deal. */
  dealEarly: () => void;
}

/** One beat: how long the hand stays off, and whether it opens on a replay. */
interface Beat {
  length: number;
  replay: boolean;
}

/** The last answered step with this question, as an instant delta. */
function fromTranscript(question: string | null, transcript: readonly SetupStep[], goals: readonly SetupGoal[]) {
  if (question === null) return null;
  const step = [...transcript].reverse().find((s) => s.status === 'answered' && s.question === question);
  return step ? instantDelta(step, goals) : null;
}

export function useAnswerBeat({ question, verdict, liveStep, goals, transcript, reduced }: AnswerBeatInput): AnswerBeat {
  const [beat, setBeat] = useState<Beat | null>(null);
  const [delta, setDelta] = useState<BlueprintDelta | null>(null);

  const deltaRef = useRef<BlueprintDelta | null>(null);
  /** The new answer's delta, waiting behind a replay of the previous one. */
  const queuedRef = useRef<BlueprintDelta | null>(null);
  const replayingRef = useRef(false);
  /** A reconciled delta that landed while a card covered the blueprint. */
  const owedRef = useRef<BlueprintDelta | null>(null);
  /** The question answered before the snapshot read knew its step. */
  const unresolvedRef = useRef<string | null>(null);
  const holdingRef = useRef(false);
  holdingRef.current = beat !== null;
  const latest = useRef({ question, liveStep, goals, transcript, reduced });
  latest.current = { question, liveStep, goals, transcript, reduced };

  const show = useCallback((next: BlueprintDelta | null) => {
    deltaRef.current = next;
    setDelta(next);
  }, []);
  const endReplay = useCallback(() => {
    if (!replayingRef.current) return;
    replayingRef.current = false;
    show(queuedRef.current);
    queuedRef.current = null;
  }, [show]);
  const dealEarly = useCallback(() => {
    endReplay();
    setBeat(null);
  }, [endReplay]);

  // The answer: lift the hand and play its delta, behind any owed replay.
  const prevVerdict = useRef<TurnVerdict>(verdict);
  useEffect(() => {
    const was = prevVerdict.current;
    prevVerdict.current = verdict;
    if (verdict !== 'played' || was === 'played') return;
    const now = latest.current;
    const instant =
      now.liveStep && now.liveStep.question === now.question
        ? instantDelta(now.liveStep, now.goals)
        : fromTranscript(now.question, now.transcript, now.goals);
    unresolvedRef.current = instant ? null : now.question;
    const replay = now.reduced ? null : owedRef.current;
    owedRef.current = null;
    replayingRef.current = replay !== null;
    queuedRef.current = replay ? instant : null;
    // A fresh object for the replay: the variant sees a new delta and plays it again.
    show(replay ? { ...replay } : instant);
    setBeat({ length: (replay ? REPLAY_MS : 0) + (now.reduced ? BEAT_REDUCED_MS : BEAT_MS), replay: replay !== null });
  }, [verdict, show]);

  // The beat's clock. Tied to the beat object, so dealing early or unmounting clears it.
  useEffect(() => {
    if (!beat) return;
    const replayTimer = beat.replay ? window.setTimeout(endReplay, REPLAY_MS) : undefined;
    const holdTimer = window.setTimeout(() => setBeat(null), beat.length);
    return () => {
      window.clearTimeout(replayTimer);
      window.clearTimeout(holdTimer);
    };
  }, [beat, endReplay]);

  // A newer snapshot: resolve a late instant delta, and land the reconcile.
  useEffect(() => {
    if (unresolvedRef.current !== null) {
      const late = fromTranscript(unresolvedRef.current, transcript, goals);
      if (late) {
        unresolvedRef.current = null;
        if (replayingRef.current) queuedRef.current = late;
        else show(late);
      }
    }
    const queued = queuedRef.current;
    if (queued) queuedRef.current = reconciledDelta(queued, transcript, goals);
    const current = deltaRef.current;
    if (!current || replayingRef.current) return;
    const next = reconciledDelta(current, transcript, goals);
    if (next === current) return;
    show(next);
    if (!holdingRef.current) owedRef.current = next;
  }, [transcript, goals, show]);

  // Any key during the beat deals early. On the app's key ladder at the route
  // rung: the overlay's own Escape and Tab (its BaseModal, far above) still win,
  // and they are passive here anyway.
  const holding = beat !== null;
  useAppKeyboard(
    (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || PASSIVE_KEYS.has(e.key)) return false;
      dealEarly();
      return true;
    },
    { enabled: holding, priority: ROUTE_DECISION_PRIORITY },
  );

  return { holding, delta, dealEarly };
}
