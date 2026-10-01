/**
 * Radial (spark twin-portable-blueprint, WP10): the pure arithmetic behind the
 * anatomy ring. Every scale here is a DECLARED domain (a count the prompt
 * compiler or the coverage scorer caps at, a 1..5 style dimension, a 0..1
 * share), never the sample's own min/max, so a ring drawn today and one drawn
 * after ten more answers stay comparable. `null` is "not measured" all the way
 * through; nothing here turns it into 0.
 */
import type {
  BlueprintChannel, BlueprintDelta, BlueprintGoal, BlueprintTopic, SectionId, TopicId, TwinBlueprintModel,
} from '../../blueprintContract';
import { COVERAGE_COVERED_THRESHOLD } from '../../../sub_training/topicCoverage';
import { STYLE_MAX } from '../../../setup/style/styleContract';
import { DEPLOYMENT_CHANNELS, TONE_CHANNELS } from '../../../shared/channels';

/** The prompt compiler renders up to five exemplars per channel (WP2): a full samples spoke. */
export const EXEMPLARS_FULL_AT = 5;
/** ...and up to eight constraints per channel: a full rules spoke. */
export const RULES_FULL_AT = 8;
/** A topic reads as covered at this many approved answers (topicCoverage.ts). */
export const TOPIC_FULL_AT = COVERAGE_COVERED_THRESHOLD;
/** Style dims are integers 1..5 (styleContract.ts). */
export const DIM_MAX = STYLE_MAX;
/** Language marks drawn before the strip shows its overflow chevrons. */
export const LANGUAGE_MARKS = 6;
/** Fact ticks on the L1 band and on the L2 ring before the overflow chevrons. */
export const FACT_TICKS = 20;
export const FACT_TICKS_DETAIL = 48;

export const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** A count on a declared domain, as a 0..1 share (overflow clamps; the caller draws the overflow mark). */
export const share = (value: number, fullAt: number) => clamp01(value / fullAt);

/** The twin's centre mark: the first user-perceived character, never half a surrogate pair. */
export function monogram(name: string): string {
  const first = [...name.trim()][0];
  return first ? first.toLocaleUpperCase() : '';
}

/**
 * A tone channel as its product writes it ("SMS", "WhatsApp"); `generic` is the
 * caller's translated "everywhere"; an unknown id is capitalised whole-codepoint.
 * (Could be shared: the experience helper prints "Sms" / "Whatsapp".)
 */
export function channelLabel(channel: string, everywhere: string): string {
  if (channel === 'generic') return everywhere;
  const meta = TONE_CHANNELS.find((c) => c.id === channel) ?? DEPLOYMENT_CHANNELS.find((c) => c.id === channel);
  if (meta) return meta.label;
  const [first = '', ...rest] = [...channel];
  return first.toLocaleUpperCase() + rest.join('');
}

/** A channel's share of the Voice headline (sectionMetrics.ts): directives 1, a stored style only 0.5. */
export function channelCredit(c: BlueprintChannel): number {
  return c.hasDirectives ? 1 : c.dims ? 0.5 : 0;
}

/** One topic as a stacked wedge: the approved share, the awaiting share after it, and whether it runs past full. */
export function topicShares(topic: BlueprintTopic): { solid: number; extra: number; overflow: boolean } {
  const solid = share(topic.approved, TOPIC_FULL_AT);
  const total = share(topic.approved + topic.awaiting, TOPIC_FULL_AT);
  return { solid, extra: total - solid, overflow: topic.approved + topic.awaiting > TOPIC_FULL_AT };
}

export interface MemoryParts {
  approved: number;
  pending: number;
  rejected: number;
  total: number;
}

/** The tri-arc's three counts; `null` when not one of them was measured. */
export function memoryParts(memories: TwinBlueprintModel['knowledge']['memories']): MemoryParts | null {
  const { approved, pending, rejected } = memories;
  if (approved === null && pending === null && rejected === null) return null;
  const a = approved ?? 0;
  const p = pending ?? 0;
  const r = rejected ?? 0;
  return { approved: a, pending: p, rejected: r, total: a + p + r };
}

/** The plan's goals that still count (a dropped goal is drawn dashed, never in the mean). */
export function liveGoals(model: TwinBlueprintModel): BlueprintGoal[] {
  return model.training.goals.filter((g) => g.state !== 'dropped');
}

/** The section a goal's slot belongs to. */
export function goalSection(slot: string): SectionId {
  if (slot === 'identity') return 'identity';
  if (slot === 'tone' || slot === 'channels') return 'voice';
  if (slot === 'memories') return 'knowledge';
  return 'training';
}

export interface DeltaTarget {
  section: SectionId;
  goal: BlueprintGoal | null;
  topicId: TopicId | null;
}

/**
 * Where an answer lands on the ring: the goal's slot when the goal is known,
 * then the tone channel the step was about, then the topic, then the kind.
 * (Could be shared: strata carries the same order.)
 */
export function deltaTarget(delta: BlueprintDelta, model: TwinBlueprintModel): DeltaTarget {
  const goal = delta.goalId ? model.training.goals.find((g) => g.id === delta.goalId) ?? null : null;
  const topicId = delta.topicId;
  if (goal) return { section: goalSection(goal.slot), goal, topicId };
  if (delta.channel) return { section: 'voice', goal: null, topicId };
  if (topicId) return { section: 'training', goal: null, topicId };
  if (delta.kind === 'fact') return { section: 'knowledge', goal: null, topicId };
  if (delta.kind === 'reply_drill' || delta.kind === 'rule' || delta.kind === 'preference') {
    return { section: 'voice', goal: null, topicId };
  }
  return { section: 'training', goal: null, topicId };
}

export interface RadialStat {
  key: string;
  label: string;
  /** `null` = not measured; drawn as "-". */
  value: number | null;
}

type MetricLabels = {
  bio: string; languages: string; channels: string; samples: string;
  approved: string; awaiting: string; answers: string; goals: string;
};

/** The two quantities a segment's outside label prints under its headline fill. */
export function sectionStats(model: TwinBlueprintModel, section: SectionId, m: MetricLabels): RadialStat[] {
  switch (section) {
    case 'identity':
      return [
        { key: 'bio', label: m.bio, value: model.identity.bioChars },
        { key: 'languages', label: m.languages, value: model.identity.languages.length },
      ];
    case 'voice':
      return [
        { key: 'channels', label: m.channels, value: model.voice.channels.length },
        { key: 'samples', label: m.samples, value: model.voice.channels.reduce((s, c) => s + c.exemplars, 0) },
      ];
    case 'knowledge':
      return [
        { key: 'approved', label: m.approved, value: model.knowledge.memories.approved },
        { key: 'awaiting', label: m.awaiting, value: model.knowledge.memories.pending },
      ];
    case 'training':
      return [
        { key: 'answers', label: m.answers, value: model.training.answered },
        { key: 'goals', label: m.goals, value: liveGoals(model).length },
      ];
  }
}
