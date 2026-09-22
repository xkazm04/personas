/**
 * The Setup module's wire contract — hand-written mirror of the Rust types
 * behind `twin_setup_turn`, plus the shape the Setup Desk renders.
 *
 * Why a hand-written mirror rather than the generated bindings: the renderer
 * and the engine were built in parallel, and this file is the seam that lets
 * them compile independently. WP1 makes the Rust structs
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
 * Which column of a tone row a `kind: 'tone'` proposal fills. `'voice'` (the
 * voice directives, and the reading when absent) replaces; `'examples'` and
 * `'constraints'` APPEND one item to the stored list.
 *
 * `'examples'` never comes from the generator — the backend drops it. A
 * sample message has to be the person's own words, so the session offers one
 * itself, verbatim, when they answer a `write` turn. The research behind that
 * rule is in `experience/RESEARCH.md`: a twin learns a voice from real
 * samples far better than from descriptions, and a sample the model wrote
 * would teach it the model's voice.
 */
export type SetupProposalPart = 'voice' | 'examples' | 'constraints';

/**
 * A typed value the guide proposes for a real field. Nothing here is written
 * until the user accepts it, and an accepted value stays editable.
 */
export interface SetupProposal {
  /** Stable per-turn id. Two tone proposals for one channel must not collide. */
  id: string;
  kind: 'bio' | 'role' | 'tone';
  /** Tone proposals only; absent or null reads as `'voice'`. */
  part?: SetupProposalPart | null;
  /** Tone channel id for `kind: 'tone'`; null otherwise. */
  channel: string | null;
  value: string;
  lengthHint: string | null;
  reason: string;
}

/**
 * How the live question wants answering. `'pick'`: the suggestions are real
 * alternatives. `'write'`: the answer is itself a writing sample (a reply
 * drill, a pasted message), so it is typed, and the hand is empty by contract.
 */
export type SetupAnswerMode = 'pick' | 'write';

export interface SetupTurnResult {
  question: string;
  focus: SetupFocus;
  toneChannel: string | null;
  answerMode: SetupAnswerMode;
  /** The message a `write` turn asks them to reply to; null otherwise. */
  incoming: string | null;
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
  /**
   * What the user did with each proposal, keyed by `SetupProposal.id`. One
   * guide turn can carry three proposals with three different verdicts, so
   * this is a map rather than a single field.
   */
  resolutions?: Record<string, 'accepted' | 'edited' | 'dismissed'>;
}

/**
 * Which column of a tone row an edit sets. A tone row is upserted WHOLE
 * (`twin_upsert_tone` writes all four columns), so an edit has to name the part
 * it means and let the session carry the other three over from the stored row —
 * otherwise typing an example would blank the voice directives.
 */
export type SetupTonePart = 'voice' | 'examples' | 'constraints' | 'lengthHint';

/** Direct-edit surface: every slot is reachable without saying a word. */
export interface SetupFieldEdit {
  field: 'name' | 'role' | 'bio' | 'obsidianSubpath' | 'tone';
  /** Tone channel id when `field === 'tone'`. */
  channel?: string;
  /** Tone edits only. Defaults to `'voice'`, which is what the guide proposes. */
  part?: SetupTonePart;
  value: string;
  lengthHint?: string;
}

export interface SetupSessionApi {
  stage: SetupStage;
  /**
   * Current stored value of every editable slot, so the typed fields surface
   * opens on what is saved rather than on nothing. Keys mirror
   * `SetupFieldEdit`: 'name' | 'role' | 'bio' | 'obsidianSubpath' |
   * `tone:<channel>` for the voice directives, plus
   * `tone:<channel>:examples` | `:constraints` | `:lengthHint` for the rest of
   * the tone row. The three suffixed keys carry the STORED format verbatim —
   * `examples` and `constraints` are the raw JSON arrays the column holds — so
   * the surface that renders them owns the presentation and nothing in between
   * rewrites what is on disk.
   */
  values: Record<string, string>;
  focus: SetupFocus;
  checklist: SetupChecklistItem[];
  /** 0–100, from `deriveReadiness`. The single completion authority. */
  score: number;
  question: string | null;
  /** How the live question wants answering. `'pick'` whenever there is none. */
  answerMode: SetupAnswerMode;
  /** The message a `write` turn asks them to reply to, or null. */
  incoming: string | null;
  /** Tone channel the live question is about, or null. */
  toneChannel: string | null;
  suggestions: SetupSuggestion[];
  proposals: SetupProposal[];
  history: SetupHistoryEntry[];
  /** True while a turn is in flight. Controls belong to the pressed control. */
  busy: boolean;
  /** Set when the generator failed. The slot stays OPEN; the form still works. */
  generatorError: string | null;
  /**
   * Tone slots the guide will cover: 'generic' + every bound channel type +
   * every channel that already has a tone row (a register the person named in
   * conversation and accepted, with no bound channel behind it yet).
   */
  toneChannels: string[];
  answer: (text: string) => Promise<void>;
  accept: (proposal: SetupProposal) => Promise<void>;
  dismiss: (proposal: SetupProposal) => void;
  edit: (change: SetupFieldEdit) => Promise<void>;
  /** A skipped question is recorded as declined, never stored as a value. */
  skip: () => Promise<void>;
  /**
   * Ask a fresh question on the current slot or training topic, replacing the
   * live one. For a topic just picked, a stage just switched, or a turn that
   * failed. Nothing is recorded; a call while a turn is in flight is ignored.
   */
  redeal: () => void;
  focusOn: (focus: SetupFocus) => void;
  setStage: (stage: SetupStage) => void;
  /** Training topic when `stage === 'training'`. */
  topic: string | null;
  /**
   * WHICH preset that topic came from, when it came from one.
   *
   * The prompt text alone cannot be scored: it is a translated sentence, and
   * coverage has to know the preset id to credit a session to a topic without
   * guessing from English keywords. Null for a topic the user typed.
   */
  topicPreset: string | null;
  setTopic: (topic: string | null, presetId?: string | null) => void;
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

/** What the Desk renders against. One surface now, so no variant id. */
export interface SetupDeskProps {
  session: SetupSessionApi;
  voice: SetupVoiceApi;
  /** Jump a footer/strip click to a slot that lives in the Hub. */
  onOpenHub: (slot: TwinSlotId) => void;
}
