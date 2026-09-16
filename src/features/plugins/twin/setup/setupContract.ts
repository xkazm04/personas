/**
 * The Setup module's wire contract — hand-written mirror of the Rust types
 * behind `twin_setup_turn`, plus the shape every Setup variant renders.
 *
 * Why a hand-written mirror rather than the generated bindings: the four
 * variant renderers and the engine are built in parallel, and this file is
 * the seam that lets them compile independently. WP1 makes the Rust structs
 * match these names field for field (`#[serde(rename_all = "camelCase")]`).
 *
 * The governing rule (wizard-flows / ai-driven-elicitation): the generator
 * proposes CONTENT; this flow owns STRUCTURE. `doneHint` is advisory. A slot
 * is complete only when `deriveReadiness` says so, and a generator failure
 * leaves the slot open rather than reading as finished.
 */

import type { TwinSlotId, TwinSlotStatus } from '../shared/twinStatus';

/** Which slots the guided conversation itself can fill. */
export type SetupFocus = 'identity' | 'tone' | 'channels' | 'memories';

export const SETUP_FOCUS_ORDER: readonly SetupFocus[] = ['identity', 'tone', 'channels', 'memories'] as const;

export type SetupStage = 'setup' | 'training';

export interface SetupTurnMessage {
  role: 'guide' | 'user';
  text: string;
}

/** One offered answer. A suggestion is a position, never a silent default. */
export interface SetupSuggestion {
  text: string;
  reason: string;
}

/**
 * A typed value the guide proposes for a real field. Nothing here is written
 * until the user accepts it, and an accepted value stays editable.
 */
export interface SetupProposal {
  kind: 'bio' | 'role' | 'tone';
  /** Tone channel id for `kind: 'tone'`; null otherwise. */
  channel: string | null;
  value: string;
  lengthHint: string | null;
  reason: string;
}

export interface SetupTurnResult {
  question: string;
  focus: SetupFocus;
  toneChannel: string | null;
  suggestions: SetupSuggestion[];
  proposals: SetupProposal[];
  /** ADVISORY. Never the completion authority — see the file header. */
  doneHint: boolean;
}

/** One row of the thin readiness strip that replaces the old readiness panel. */
export interface SetupChecklistItem {
  id: SetupFocus;
  status: TwinSlotStatus;
  /** Short measured fact, e.g. "62 words", "2 of 4 channels". Never a sentence. */
  detail: string;
  /** i18n key under `twin.setup.checklist`. */
  labelKey: SetupFocus;
}

/** A transcript line as the variants render it. */
export interface SetupHistoryEntry {
  id: string;
  role: 'guide' | 'user';
  text: string;
  /** Proposals that arrived with this guide turn; they stay in the record. */
  proposals?: SetupProposal[];
  /** Set once the user has acted on a proposal row. */
  resolution?: 'accepted' | 'edited' | 'dismissed';
}

/** Direct-edit surface: every slot is reachable without saying a word. */
export interface SetupFieldEdit {
  field: 'name' | 'role' | 'bio' | 'obsidianSubpath' | 'tone';
  /** Tone channel id when `field === 'tone'`. */
  channel?: string;
  value: string;
  lengthHint?: string;
}

export interface SetupSessionApi {
  stage: SetupStage;
  focus: SetupFocus;
  checklist: SetupChecklistItem[];
  /** 0–100, from `deriveReadiness`. The single completion authority. */
  score: number;
  question: string | null;
  suggestions: SetupSuggestion[];
  proposals: SetupProposal[];
  history: SetupHistoryEntry[];
  /** True while a turn is in flight. Controls belong to the pressed control. */
  busy: boolean;
  /** Set when the generator failed. The slot stays OPEN; the form still works. */
  generatorError: string | null;
  /** Tone slots the guide will cover: 'generic' + every bound channel type. */
  toneChannels: string[];
  answer: (text: string) => Promise<void>;
  accept: (proposal: SetupProposal) => Promise<void>;
  dismiss: (proposal: SetupProposal) => void;
  edit: (change: SetupFieldEdit) => Promise<void>;
  /** A skipped question is recorded as declined, never stored as a value. */
  skip: () => Promise<void>;
  focusOn: (focus: SetupFocus) => void;
  setStage: (stage: SetupStage) => void;
  /** Training topic when `stage === 'training'`. */
  topic: string | null;
  setTopic: (topic: string | null) => void;
}

export interface SetupVoiceApi {
  /** False when no engine is available. Controls then say so in one line. */
  supported: boolean;
  listening: boolean;
  /** Interim text is shown, never acted on. Only final transcripts submit. */
  interim: string;
  error: string | null;
  speakEnabled: boolean;
  handsFree: boolean;
  start: () => void;
  stop: () => void;
  toggleSpeak: () => void;
  toggleHandsFree: () => void;
  /** Speaks a guide question. The flow never waits on it. */
  speak: (text: string) => void;
}

/** Variant ids for the Setup switcher (localStorage key `twin-variant:setup`). */
export type SetupVariantId = 'conversation' | 'orbit' | 'desk' | 'canvas';

export interface SetupVariantProps {
  session: SetupSessionApi;
  voice: SetupVoiceApi;
  /** Jump a footer/strip click to a slot that lives in the Hub. */
  onOpenHub: (slot: TwinSlotId) => void;
}
