/**
 * Create Athena — the engine's NON-persisted per-run state: which steps
 * were done/skipped this run, the per-step answers, and whether Athena has
 * spoken yet. Everything the real store keys already record (footer/orb/
 * chime enabled, engine, voice ids, STT engine) stays out of here.
 */
import type { SttEngineId } from '@/api/companion';
import type { CreateAthenaFeature, CreateAthenaStepId } from './createAthenaTypes';

export type IntroMode = 'fresh' | 'resume' | 'done';

export interface CreateAthenaLocal {
  introMode: IntroMode;
  done: CreateAthenaStepId[];
  skipped: CreateAthenaStepId[];
  choices: Partial<Record<CreateAthenaFeature, 'keep' | 'off'>>;
  orbConfirmed: boolean;
  engineConfirmed: boolean;
  sttPicked: SttEngineId | null;
  wokeUp: boolean;
}

export type CreateAthenaLocalAction =
  | { type: 'mark'; done?: CreateAthenaStepId[]; skipped?: CreateAthenaStepId[] }
  | { type: 'choice'; feature: CreateAthenaFeature; choice: 'keep' | 'off' }
  | { type: 'orbConfirmed' }
  | { type: 'engineConfirmed'; value: boolean }
  | { type: 'sttPicked'; id: SttEngineId }
  | { type: 'woke' }
  | { type: 'restart'; introMode: IntroMode };

export function initialLocal(introMode: IntroMode): CreateAthenaLocal {
  return {
    introMode,
    done: [],
    skipped: [],
    choices: {},
    orbConfirmed: false,
    engineConfirmed: false,
    sttPicked: null,
    wokeUp: false,
  };
}

export function reduceLocal(s: CreateAthenaLocal, a: CreateAthenaLocalAction): CreateAthenaLocal {
  switch (a.type) {
    case 'mark': {
      // A step re-entered after being skipped (orb turned back on) must be
      // able to become done, and vice versa — the two sets stay disjoint.
      const done = a.done ?? [];
      const skipped = a.skipped ?? [];
      return {
        ...s,
        done: [...new Set([...s.done.filter((id) => !skipped.includes(id)), ...done])],
        skipped: [...new Set([...s.skipped.filter((id) => !done.includes(id)), ...skipped])],
      };
    }
    case 'choice':
      return { ...s, choices: { ...s.choices, [a.feature]: a.choice } };
    case 'orbConfirmed':
      return { ...s, orbConfirmed: true };
    case 'engineConfirmed':
      return { ...s, engineConfirmed: a.value };
    case 'sttPicked':
      return { ...s, sttPicked: a.id };
    case 'woke':
      return { ...s, wokeUp: true };
    case 'restart':
      return initialLocal(a.introMode);
  }
}
