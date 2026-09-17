/**
 * Create Athena — the wire-level contract between the ONE engine
 * (`useCreateAthenaEngine`) and the THREE presentational shells under
 * `../variants/`. Every identifier here is load-bearing: the variants are
 * built in parallel against this file, so a rename lands in all four places
 * or nowhere.
 *
 * Design brief: Obsidian vault `Spark/ideas/athena-onboarding.md`.
 */
import type { SttEngineId, TtsEngineId } from '@/api/companion';
import type { EngineTake } from '@/features/plugins/companion/useSttComparison';

/** Ordered wizard steps. The engine owns the order; shells only render. */
export type CreateAthenaStepId =
  | 'intro'
  | 'footer_icon'
  | 'orb'
  | 'orb_place'
  | 'chime'
  | 'voice_engine'
  | 'voice_install'
  | 'voice_pick'
  | 'stt'
  | 'handoff';

export const CREATE_ATHENA_STEP_ORDER: readonly CreateAthenaStepId[] = [
  'intro',
  'footer_icon',
  'orb',
  'orb_place',
  'chime',
  'voice_engine',
  'voice_install',
  'voice_pick',
  'stt',
  'handoff',
] as const;

/** The three chrome features the Setup steps demonstrate live. */
export type CreateAthenaFeature = 'footer_icon' | 'orb' | 'chime';

export type CreateAthenaStepStatus = 'done' | 'current' | 'todo' | 'skipped';

export interface CreateAthenaStep {
  id: CreateAthenaStepId;
  status: CreateAthenaStepStatus;
}

/**
 * Engine/model install state for the chosen TTS engine.
 * `not_needed` — already installed; `manual` — `canAutoInstall === false`
 * (non-Windows), the card shows download links + "check again".
 */
export interface InstallState {
  phase:
    | 'not_needed'
    | 'idle'
    | 'downloading_engine'
    | 'downloading_model'
    | 'extracting'
    | 'completed'
    | 'failed'
    | 'manual';
  bytesDownloaded: number;
  bytesTotal: number | null;
  error: string | null;
  /** Manual-install links, present only in `manual`. */
  engineDownloadUrl: string | null;
  modelDownloadUrl: string | null;
}

export interface EngineOption {
  id: TtsEngineId;
  installed: boolean;
  canAutoInstall: boolean;
}

export interface VoiceOption {
  voiceId: string;
  /** Display name (speaker / voice name). */
  label: string;
  /** Secondary line: language · gender · grade, or category. `null` when none. */
  meta: string | null;
}

/**
 * The single interactive object on screen for the current step. Shells
 * switch on `kind` and must render every kind.
 */
export type CreateAthenaCard =
  | { kind: 'intro'; mode: 'fresh' | 'resume' | 'done' }
  | {
      kind: 'keep_toggle';
      feature: CreateAthenaFeature;
      /** Live value of the real store key (already flipped ON on step entry). */
      enabled: boolean;
      recommended: 'keep' | 'off';
      /** Translated one-line reason for the recommendation. */
      why: string;
      /** The user's choice for this step, `null` until made. */
      choice: 'keep' | 'off' | null;
    }
  | { kind: 'orb_place'; confirmed: boolean }
  | {
      kind: 'engine_pick';
      options: EngineOption[];
      selected: TtsEngineId;
      recommended: TtsEngineId;
      /** Translated one-line reason for the recommendation. */
      why: string;
      /** `true` once the user explicitly confirmed an engine. */
      confirmed: boolean;
    }
  | { kind: 'install'; engine: TtsEngineId; state: InstallState }
  | {
      kind: 'voice_pick';
      engine: TtsEngineId;
      voices: VoiceOption[];
      loading: boolean;
      selected: string | null;
      previewVoiceId: string | null;
      preview: 'idle' | 'synth' | 'playing';
      /** `true` after the wake-up line has been spoken once this run. */
      wokeUp: boolean;
    }
  | {
      kind: 'stt';
      recording: boolean;
      busy: boolean;
      browser: EngineTake;
      whisper: EngineTake;
      whisperInstalled: boolean;
      /** Mic permission or capture failure, translated. `null` when fine. */
      micError: string | null;
      picked: SttEngineId | null;
    }
  | { kind: 'handoff'; hasClaudeLogin: boolean; voiceReady: boolean };

export interface CreateAthenaLine {
  /** Stable id per line text so shells can key re-typing on change. */
  id: string;
  /** Already-translated text. */
  text: string;
}

export interface CreateAthenaActions {
  next: () => void;
  back: () => void;
  /** Mark the current step skipped and advance. */
  skip: () => void;
  /** Jump to a step that is `done` or `skipped` (rails only). */
  goTo: (id: CreateAthenaStepId) => void;
  /** Reset the persisted pointer, `wokeUp`, and every per-step choice. */
  restart: () => void;
  /** Setup steps: flips the real store key and records the choice. */
  keepFeature: (feature: CreateAthenaFeature, keep: boolean) => void;
  /** orb_place: the user is happy with where the orb sits. */
  confirmOrbPlace: () => void;
  /**
   * chime: play the reply chime again (the step already played it once on
   * entry). No-op while `companionSoundEnabled` is off. Added by WP1 —
   * the card's "Play it again" button binds here.
   */
  replayChime: () => void;
  selectEngine: (id: TtsEngineId) => void;
  confirmEngine: () => void;
  startInstall: () => void;
  retryInstall: () => void;
  recheckInstall: () => void;
  selectVoice: (voiceId: string) => void;
  /** Speaks the wake-up line the first time, `voice_test_sentence` after. */
  previewVoice: (voiceId: string) => void;
  stopPreview: () => void;
  sttStart: () => void;
  sttStop: () => void;
  sttPick: (id: SttEngineId) => void;
  /** Stamp completion, re-enable voice if picked, open the chat. */
  finish: () => void;
}

export interface CreateAthenaEngine {
  stepId: CreateAthenaStepId;
  stepIndex: number;
  stepCount: number;
  steps: CreateAthenaStep[];
  line: CreateAthenaLine;
  card: CreateAthenaCard;
  /** TTS audio is currently playing (drives `AthenaWaveform`). */
  speaking: boolean;
  /** `false` until the current card's choice is made (nothing applies on silence). */
  canNext: boolean;
  canBack: boolean;
  actions: CreateAthenaActions;
}

/** Props every variant shell receives. Nothing else. */
export interface CreateAthenaVariantProps {
  engine: CreateAthenaEngine;
}

/** `data-testid`s the Setup steps glow via `flashHighlight`. Verified 2026-09-17. */
export const CREATE_ATHENA_HIGHLIGHT_TEST_IDS: Record<
  Exclude<CreateAthenaFeature, 'chime'>,
  string
> = {
  footer_icon: 'footer-companion',
  orb: 'companion-orb',
};
