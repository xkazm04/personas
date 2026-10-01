/**
 * The training overlay's blueprint (spark twin-portable-blueprint): the model
 * for the active twin, re-read whenever the session moves, and the answer beat
 * that plays each answer on it.
 *
 * The session's own snapshot is private to `useSetupSession` (the table's
 * render contract carries no step ids or kinds), so the blueprint keeps its
 * own copy through `setupGet`, a pure read, refreshed on every signal the
 * session exposes: a new question, a reconcile starting or finishing, a new
 * plan, a stage switch. Each of those is one local read; nothing here can
 * start LLM work.
 */
import type { SetupGoal } from '@/lib/bindings/SetupGoal';
import type { SetupStep } from '@/lib/bindings/SetupStep';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';

import type { SetupSessionApi } from '../setup/setupContract';
import type { TurnVerdict } from '../experience/table/useTurn';
import type { BlueprintDelta, TwinBlueprintModel } from './blueprintContract';
import { useAnswerBeat } from './useAnswerBeat';
import { useTwinBlueprint } from './useTwinBlueprint';

const NO_STEPS: readonly SetupStep[] = [];
const NO_GOALS: readonly SetupGoal[] = [];

export interface StageBlueprint {
  model: TwinBlueprintModel | null;
  delta: BlueprintDelta | null;
  /** The hand is held off the table for the beat. */
  holding: boolean;
  /** No question is live and the engine is working: the blueprint is the waiting surface. */
  working: boolean;
  reduced: boolean;
}

/** A number that changes whenever the signature does: a refresh key, not a checksum. */
function keyOf(signature: string): number {
  let key = 0;
  for (let i = 0; i < signature.length; i++) key = (Math.imul(key, 31) + signature.charCodeAt(i)) | 0;
  return key;
}

export function useStageBlueprint(twinId: string | null, session: SetupSessionApi, verdict: TurnVerdict): StageBlueprint {
  const reduced = useReducedMotion();
  const signature = [
    session.question ?? '',
    session.history.length,
    session.stage,
    session.reconciling ? 'r' : '',
    session.planning ? 'p' : '',
    session.plan?.version ?? 0,
    session.plan?.status ?? '',
  ].join('|');
  const { model, sources } = useTwinBlueprint(twinId, { refreshKey: keyOf(signature) });
  const snapshot = sources?.snapshot ?? null;
  const beat = useAnswerBeat({
    question: session.question,
    verdict,
    liveStep: snapshot?.live ?? null,
    goals: snapshot?.goals ?? NO_GOALS,
    transcript: snapshot?.transcript ?? NO_STEPS,
    reduced,
  });
  return { model, delta: beat.delta, holding: beat.holding, working: session.busy, reduced };
}
