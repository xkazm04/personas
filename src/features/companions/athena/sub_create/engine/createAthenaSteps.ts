/**
 * Create Athena — pure step metadata: ordering helpers, status derivation,
 * the line-per-step resolver and the wake-up pool picker. No React, no
 * stores — everything here is a function of its arguments so the engine
 * stays testable and the shells never need to know the rules.
 */
import type { Translations } from '@/i18n/generated/types';
import {
  CREATE_ATHENA_STEP_ORDER,
  type CreateAthenaLine,
  type CreateAthenaStep,
  type CreateAthenaStepId,
  type InstallState,
} from './createAthenaTypes';

type CompanionStrings = Translations['plugins']['companion'];

export function stepIndexOf(id: CreateAthenaStepId): number {
  return CREATE_ATHENA_STEP_ORDER.indexOf(id);
}

export function stepAt(index: number): CreateAthenaStepId | null {
  return CREATE_ATHENA_STEP_ORDER[index] ?? null;
}

/**
 * Steps the wizard walks over without stopping, given the live choices.
 * `orb_place` is pointless with the orb off; `voice_install` is pointless
 * when the chosen engine is already on disk. `null` install state means
 * "not known yet" — the engine then stops on the step and the install
 * hook auto-advances once status arrives.
 */
export interface AutoSkipContext {
  orbEnabled: boolean;
  installPhase: InstallState['phase'] | null;
}

export function autoSkipKind(
  id: CreateAthenaStepId,
  ctx: AutoSkipContext,
): 'skipped' | 'done' | null {
  if (id === 'orb_place' && !ctx.orbEnabled) return 'skipped';
  if (id === 'voice_install' && ctx.installPhase === 'not_needed') return 'done';
  return null;
}

/** First step after `from` (walking `dir`) that is not auto-skipped, and the ones passed over. */
export function resolveMove(
  from: CreateAthenaStepId,
  dir: 1 | -1,
  ctx: AutoSkipContext,
): { target: CreateAthenaStepId | null; passed: Array<{ id: CreateAthenaStepId; as: 'skipped' | 'done' }> } {
  const passed: Array<{ id: CreateAthenaStepId; as: 'skipped' | 'done' }> = [];
  let i = stepIndexOf(from) + dir;
  while (i >= 0 && i < CREATE_ATHENA_STEP_ORDER.length) {
    const id = CREATE_ATHENA_STEP_ORDER[i]!;
    const kind = autoSkipKind(id, ctx);
    if (!kind) return { target: id, passed };
    passed.push({ id, as: kind });
    i += dir;
  }
  return { target: null, passed };
}

export function deriveSteps(
  current: CreateAthenaStepId,
  done: ReadonlySet<CreateAthenaStepId>,
  skipped: ReadonlySet<CreateAthenaStepId>,
): CreateAthenaStep[] {
  const currentIndex = stepIndexOf(current);
  return CREATE_ATHENA_STEP_ORDER.map((id, i) => {
    if (id === current) return { id, status: 'current' as const };
    if (skipped.has(id)) return { id, status: 'skipped' as const };
    // A resumed session has no local memory of earlier steps; anything
    // behind the pointer counts as done unless it was explicitly skipped.
    if (done.has(id) || i < currentIndex) return { id, status: 'done' as const };
    return { id, status: 'todo' as const };
  });
}

/** Everything the line text depends on beyond the step id. */
export interface LineContext {
  introMode: 'fresh' | 'resume' | 'done';
  installPhase: InstallState['phase'];
  wokeUp: boolean;
  voiceReady: boolean;
}

/**
 * The line Athena speaks on a step. `id` changes whenever the text does so
 * `TypedLine` re-types on the variant switch, not only on the step switch.
 */
export function resolveLine(
  c: CompanionStrings,
  stepId: CreateAthenaStepId,
  ctx: LineContext,
): CreateAthenaLine {
  switch (stepId) {
    case 'intro': {
      const text =
        ctx.introMode === 'resume'
          ? c.create_line_intro_resume
          : ctx.introMode === 'done'
            ? c.create_line_intro_done
            : c.create_line_intro;
      return { id: `intro:${ctx.introMode}`, text };
    }
    case 'voice_install': {
      if (ctx.installPhase === 'manual') {
        return { id: 'voice_install:manual', text: c.create_line_voice_install_manual };
      }
      if (ctx.installPhase === 'completed' || ctx.installPhase === 'not_needed') {
        return { id: 'voice_install:done', text: c.create_line_voice_install_done };
      }
      return { id: 'voice_install:default', text: c.create_line_voice_install };
    }
    case 'voice_pick':
      return ctx.wokeUp
        ? { id: 'voice_pick:woke', text: c.create_line_voice_pick_woke }
        : { id: 'voice_pick:default', text: c.create_line_voice_pick };
    case 'handoff':
      return ctx.voiceReady
        ? { id: 'handoff:voice', text: c.create_line_handoff }
        : { id: 'handoff:no_voice', text: c.create_line_handoff_no_voice };
    default:
      return { id: `${stepId}:default`, text: c[`create_line_${stepId}`] };
  }
}

// --- Wake-up pool -----------------------------------------------------------

/** Module counter: every third pick reaches for a generic line so repeats vary. */
let wakeUpCalls = 0;

/** Test hatch — resets the rotation so a suite starts from a known pick. */
export function resetWakeUpRotation(): void {
  wakeUpCalls = 0;
}

export function pickWakeUpLine(c: CompanionStrings, now: Date): string {
  wakeUpCalls += 1;
  if (wakeUpCalls % 3 === 0) {
    return wakeUpCalls % 2 === 0 ? c.create_wake_generic_2 : c.create_wake_generic_1;
  }
  const h = now.getHours();
  if (h >= 5 && h <= 11) return c.create_wake_morning;
  if (h >= 12 && h <= 17) return c.create_wake_afternoon;
  if (h >= 18 && h <= 22) return c.create_wake_evening;
  return c.create_wake_night;
}
