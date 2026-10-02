/**
 * The Twin blueprint: one model of "where this twin stands", drawn as layer
 * one of the Twin Detail page AND as the base layer of the training overlay
 * (spark twin-portable-blueprint). FROZEN CONTRACT (WP0): the producer
 * (`useTwinBlueprint`, `blueprintDelta`, WP6) and the four variant renderers
 * (WP7-WP10) build against these types in parallel. Change them only with
 * every consumer in the same commit.
 *
 * Conventions:
 * - A number the source cannot measure is `null`, never `0`; renderers draw
 *   it as "not measured" (hatched / "-"), never as an empty bar.
 * - Lists are never null; an empty twin has empty lists.
 * - No user-facing text lives in the model except names the user typed
 *   (twin name, role, goal titles, the model's `why`); every label a renderer
 *   shows comes from `t.twin.blueprint.*`.
 */
import type { TwinStyleDims } from '@/lib/bindings/TwinStyleDims';
import type { TRAINING_TOPIC_PRESETS } from '../sub_training/topicPresets';

/** The four hardcoded sections every variant draws. */
export type SectionId = 'identity' | 'voice' | 'knowledge' | 'training';
export const SECTION_IDS: readonly SectionId[] = ['identity', 'voice', 'knowledge', 'training'];

/**
 * The directions behind the Detail page's switcher. Round 4 (2026-10-02): the
 * owner kept the "Personas blueprint" look (round 3's level 3), and `drafting`
 * now renders it; Strata stays while its layer one is considered for another
 * module. The ids are i18n keys under `twin.blueprint.variants` (hence
 * camelCase) and persisted values (a stored id that no longer exists, such as
 * a retired theme version's, falls back to the default).
 */
export type BlueprintVariantId = 'drafting' | 'strata';
export const BLUEPRINT_VARIANT_IDS: readonly BlueprintVariantId[] = ['drafting', 'strata'];

/** `detail` = the Detail page (L1 overview, L2 section zoom); `stage` = the training overlay's base layer. */
export type BlueprintMode = 'detail' | 'stage';

/** A training topic id (`background`, `opinions`, ...). */
export type TopicId = (typeof TRAINING_TOPIC_PRESETS)[number]['id'];

/** A setup step's kind, as the engine writes it. */
export type StepKind = 'scene' | 'opinion' | 'reply_drill' | 'fact' | 'rule' | 'preference';

/** Where a channel's stored style came from; `manual` = hand-written tone, no style_json. */
export type VoiceOrigin = 'preset' | 'rolled' | 'learned' | 'manual';

export interface BlueprintChannel {
  /** Tone channel id: `generic`, `email`, `slack`, ... */
  channel: string;
  /** Stored tone examples (writing samples) for this channel. */
  exemplars: number;
  /** Stored do/don't constraints for this channel. */
  rules: number;
  /** The channel has written voice directives. */
  hasDirectives: boolean;
  /** The channel's stored style dims; `null` when no style_json is stored. */
  dims: TwinStyleDims | null;
  /** `null` when the channel has no tone row at all (bound but never voiced). */
  origin: VoiceOrigin | null;
}

export interface BlueprintTopic {
  id: TopicId;
  /** Answers credited to the topic that are approved memories. */
  approved: number;
  /** Answers credited to the topic still awaiting review (pending memories / unreviewed training rows). */
  awaiting: number;
  /** Coverage tier of `approved` (thin < 2, some 2-4, covered >= 5 - topicCoverage.ts). */
  tier: 'thin' | 'some' | 'covered';
}

export interface BlueprintGoal {
  id: string;
  /** `identity` | `tone` | `channels` | `memories` | `training:<topicId>`. */
  slot: string;
  /** The planner's title (user-language text, shown verbatim). */
  title: string;
  /** 0..1. */
  coverage: number;
  answered: number;
  /** `open` | `covered` | `dropped`. */
  state: string;
  /** The assess pass's reason for the latest coverage move; `null` until one. */
  lastWhy: string | null;
}

export type ReadinessSlot = 'identity' | 'tone' | 'channels' | 'memories';
export type ReadinessStatus = 'set' | 'partial' | 'empty';

export interface TwinBlueprintModel {
  twinId: string;
  identity: {
    name: string;
    role: string | null;
    /** Bio length in characters; `null` when there is no bio. */
    bioChars: number | null;
    /** The readiness target for the bio (characters). */
    bioTarget: number;
    /** Language codes, e.g. `['cs', 'en']`. */
    languages: string[];
  };
  voice: {
    /** `generic` first, then the rest in a stable order. */
    channels: BlueprintChannel[];
  };
  knowledge: {
    memories: { approved: number | null; pending: number | null; rejected: number | null };
    /** Distilled facts; `null` when not loaded. */
    facts: number | null;
    /** A knowledge base is bound. */
    kbBound: boolean;
  };
  training: {
    /** All six topics, in TRAINING_TOPIC_PRESETS order. */
    topics: BlueprintTopic[];
    /** The plan's goals (empty before the first plan). */
    goals: BlueprintGoal[];
    /** Steps answered across all goals (uncapped). */
    answered: number;
    /** Answered steps by kind, from the transcript. */
    kindMix: Partial<Record<StepKind, number>>;
    observations: number;
    lastTrainedAt: string | null;
  };
  readiness: {
    /** 0..100. */
    score: number;
    slots: Record<ReadinessSlot, ReadinessStatus>;
  };
  samples: {
    /** Open learn-from-sample proposals; `null` when not loaded. */
    open: number | null;
  };
}

/**
 * What the last answer changed, for stage mode to play.
 * `instant` is known the moment the answer is given (topic, kind, goal);
 * `reconciled` arrives with the reconcile pass (~6-10 s later) and adds the
 * coverage gain and the model's reason.
 */
export interface BlueprintDelta {
  answeredStepId: string;
  phase: 'instant' | 'reconciled';
  topicId: TopicId | null;
  kind: StepKind | null;
  goalId: string | null;
  /** 0..1; `null` until reconciled. */
  coverageGain: number | null;
  /** `null` until reconciled. */
  why: string | null;
  /** A tone channel the step was about, when it was about one. */
  channel: string | null;
}

/** What every variant renderer receives. */
export interface BlueprintVariantProps {
  model: TwinBlueprintModel;
  mode: BlueprintMode;
  /** L2: the section zoomed into; `null` = the L1 overview. Always `null` in stage mode. */
  focus: SectionId | null;
  onFocus: (section: SectionId | null) => void;
  /** L3: open the read-only detail drawer for a section, optionally one item (a channel id, a topic id, a goal id). Owned by the page shell. */
  onOpenDetail: (section: SectionId, itemKey?: string) => void;
  /** Stage mode: the last answer's delta to play; `null` otherwise. */
  delta: BlueprintDelta | null;
  /** Stage mode: the engine is working with no live question (the blueprint is the waiting surface). */
  working: boolean;
  /** Reduced motion is on: no travel, no loops; fades only. */
  reduced: boolean;
}
