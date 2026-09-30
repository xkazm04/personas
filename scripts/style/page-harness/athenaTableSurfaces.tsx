/**
 * Voice Studio v2 phase 1: the Create Athena "Table" shell (contest winner
 * "Across the Table") and the Stage shell it sits beside, on hand-built engine
 * states - the same contract the shells' unit tests use. No IPC: the engine is
 * a prop, and the store keys the Style Card reads are seeded in `prepare`.
 *
 *   athena/table/intro   the first line, no card, Enter to start
 *   athena/table/reach   Where I live: receipts for the answered steps, the orb card live
 *   athena/table/voice   Her voice: three preset takes, one selected
 *   athena/table/stt     Your voice: the two heard takes after a recording
 *   athena/stage/reach   the same state on Stage (before)
 *   athena/stage/voice   the same state on Stage (before)
 */
import type { ComponentType } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import {
  CREATE_ATHENA_STEP_ORDER,
  type CreateAthenaActions,
  type CreateAthenaCard,
  type CreateAthenaEngine,
  type CreateAthenaStepId,
} from '@/features/companions/athena/sub_create/engine/createAthenaTypes';
import type { HarnessModule } from './registry';

const noop = () => {};
const ACTIONS = new Proxy({}, { get: () => noop }) as CreateAthenaActions;

function engineAt(stepId: CreateAthenaStepId, card: CreateAthenaCard, text: string, canNext = false): CreateAthenaEngine {
  const stepIndex = CREATE_ATHENA_STEP_ORDER.indexOf(stepId);
  return {
    stepId, stepIndex, stepCount: CREATE_ATHENA_STEP_ORDER.length,
    steps: CREATE_ATHENA_STEP_ORDER.map((id, i) => ({ id, status: i < stepIndex ? (id === 'orb_place' ? 'skipped' : 'done') : i === stepIndex ? 'current' : 'todo' })),
    line: { id: `harness-${stepId}`, text }, card, speaking: false, canNext, canBack: stepIndex > 0, actions: ACTIONS,
  };
}

const take = (text = '') => ({ supported: true, busy: false, text, interim: '', error: null, elapsedMs: text ? 820 : null });

const STATES: Record<string, () => CreateAthenaEngine> = {
  intro: () => engineAt('intro', { kind: 'intro', mode: 'fresh' }, "Hi, I'm Athena. I live in this app to think alongside you. Give me a few minutes and I'll show you how I appear, find my voice, and learn to hear yours. Ready?"),
  reach: () => engineAt('chime', { kind: 'keep_toggle', feature: 'chime', enabled: true, recommended: 'keep', why: 'A short chime when a reply lands while you look elsewhere.', choice: null },
    "When I finish a reply while you're looking elsewhere, I play a short chime so you don't have to watch the panel. Here's how it sounds."),
  voice: () => engineAt('voice_pick', {
    kind: 'voice_pick', engine: 'kokoro', loading: false, selected: 'af_heart', previewVoiceId: null, preview: 'idle', wokeUp: true,
    voices: [
      { voiceId: 'af_heart', label: 'Heart', meta: 'English (US) · female · A' },
      { voiceId: 'af_bella', label: 'Bella', meta: 'English (US) · female · A-' },
      { voiceId: 'bf_emma', label: 'Emma', meta: 'English (UK) · female · B-' },
    ],
  }, 'There I am. Try a few more; each one says the same line so you can compare.', true),
  stt: () => engineAt('stt', {
    kind: 'stt', recording: false, busy: false, whisperInstalled: true, micError: null, picked: 'whisper',
    browser: take('open the overnight runs and tell me which failed'), whisper: take('Open the overnight runs and tell me which ones failed.'),
  }, "Now let me hear you. Hold the button, say anything, and I'll transcribe it two ways so you can pick the one that hears you best.", true),
};

function prepare(): void {
  useSystemStore.setState({
    athenaFooterEnabled: true, athenaOrbEnabled: true, athenaSoundEnabled: true,
    athenaVoiceEngine: 'kokoro', athenaKokoroVoiceId: 'af_heart', athenaVoiceSpeed: null, athenaSttEngine: 'whisper',
  });
}

function mount(shell: 'table' | 'stage', state: string): HarnessModule {
  return {
    prepare,
    load: async () => {
      const Shell: ComponentType<{ engine: CreateAthenaEngine }> = shell === 'table'
        ? (await import('@/features/companions/athena/sub_create/variants/CreateAthenaTable')).default
        : (await import('@/features/companions/athena/sub_create/variants/CreateAthenaStage')).default;
      const engine = STATES[state]!();
      return { default: () => <div className="h-full p-4"><Shell engine={engine} /></div> };
    },
  };
}

export const ATHENA_TABLE_MODULE_IDS = ['athena/table/intro', 'athena/table/reach', 'athena/table/voice', 'athena/table/stt', 'athena/stage/reach', 'athena/stage/voice'] as const;

export const ATHENA_TABLE_MODULES: Record<string, HarnessModule> = Object.fromEntries(
  ATHENA_TABLE_MODULE_IDS.map((id) => {
    const [, shell, state] = id.split('/') as [string, 'table' | 'stage', string];
    return [id, mount(shell, state)];
  }),
);
