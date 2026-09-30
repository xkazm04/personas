/**
 * Create Athena "Table" shell: the five beats of the path rail and the step
 * ids each one opens into. Pure: a function of the engine's step list, so
 * the rail and the thread agree on where the person is without state.
 */
import type { CreateAthenaStep, CreateAthenaStepId } from '../../engine/createAthenaTypes';

export type TableBeatId = 'hello' | 'home' | 'voice' | 'hear' | 'ready';

export const TABLE_BEATS: ReadonlyArray<{ id: TableBeatId; steps: readonly CreateAthenaStepId[] }> = [
  { id: 'hello', steps: ['intro'] },
  { id: 'home', steps: ['footer_icon', 'orb', 'orb_place', 'chime'] },
  { id: 'voice', steps: ['voice_engine', 'voice_install', 'voice_pick'] },
  { id: 'hear', steps: ['stt'] },
  { id: 'ready', steps: ['handoff'] },
];

export type TableBeatStatus = 'done' | 'now' | 'todo';

export interface TableBeatView {
  id: TableBeatId;
  status: TableBeatStatus;
  steps: CreateAthenaStep[];
}

export function beatOf(stepId: CreateAthenaStepId): TableBeatId {
  return TABLE_BEATS.find((b) => b.steps.includes(stepId))?.id ?? 'hello';
}

export function deriveBeats(steps: readonly CreateAthenaStep[]): TableBeatView[] {
  return TABLE_BEATS.map((beat) => {
    const own = steps.filter((s) => beat.steps.includes(s.id));
    const status: TableBeatStatus = own.some((s) => s.status === 'current')
      ? 'now'
      : own.length > 0 && own.every((s) => s.status === 'done' || s.status === 'skipped')
        ? 'done'
        : 'todo';
    return { id: beat.id, status, steps: own };
  });
}

/** Share of the path behind the person (0..1), for the rail's filled line. */
export function pathProgress(beats: readonly TableBeatView[]): number {
  const now = beats.findIndex((b) => b.status === 'now');
  if (now < 0) return beats.every((b) => b.status === 'done') ? 1 : 0;
  return beats.length > 1 ? now / (beats.length - 1) : 0;
}
