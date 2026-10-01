/**
 * Strata (spark twin-portable-blueprint, WP8): the pure arithmetic behind the
 * exploded stack. Every scale here is a DECLARED domain (a count the prompt
 * compiler or the coverage scorer caps at, a 1..5 dimension, a 0..1 share),
 * never the sample's own min/max, so a plate drawn today and one drawn after
 * ten more answers stay comparable.
 */
import type { BlueprintDelta, SectionId, TwinBlueprintModel } from '../../blueprintContract';
import { SECTION_IDS } from '../../blueprintContract';
import { COVERAGE_COVERED_THRESHOLD } from '../../../sub_training/topicCoverage';
import { DEPLOYMENT_CHANNELS, TONE_CHANNELS } from '../../../shared/channels';
import { channelName } from '../../../experience/channels';

/** The prompt compiler renders up to five exemplars per channel (WP2): a full column. */
export const EXEMPLARS_FULL_AT = 5;
/** ...and up to eight constraints per channel: a full rules column. */
export const RULES_FULL_AT = 8;
/** A topic reads as covered at this many approved answers (topicCoverage.ts). */
export const TOPIC_FULL_AT = COVERAGE_COVERED_THRESHOLD;
/** Style dims are integers 1..5 (styleContract.ts). */
export const DIM_MAX = 5;
/** Units drawn before a strip shows its overflow mark. */
export const LANGUAGE_DOTS = 6;
export const FACT_TICKS = 12;
/** Cells of the memory waffle on the Knowledge plate. */
export const WAFFLE_CELLS = 32;

/** Top plate first: the stack reads Identity (top) down to Training (base). */
export const PLATE_ORDER: readonly SectionId[] = SECTION_IDS;

export const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** A count on a declared domain, as a 0..1 share (overflow clamps; the caller draws the overflow mark). */
export const share = (value: number, fullAt: number) => clamp01(value / fullAt);

/**
 * Which plate an answer lands on: the goal's slot when the goal is known, then
 * the tone channel the step was about, then the topic, then the kind.
 */
export function deltaSection(delta: BlueprintDelta, model: TwinBlueprintModel): SectionId {
  const goal = delta.goalId ? model.training.goals.find((g) => g.id === delta.goalId) : undefined;
  if (goal) {
    if (goal.slot === 'identity') return 'identity';
    if (goal.slot === 'tone' || goal.slot === 'channels') return 'voice';
    if (goal.slot === 'memories') return 'knowledge';
    return 'training';
  }
  if (delta.channel) return 'voice';
  if (delta.topicId) return 'training';
  if (delta.kind === 'fact') return 'knowledge';
  if (delta.kind === 'reply_drill' || delta.kind === 'rule' || delta.kind === 'preference') return 'voice';
  return 'training';
}

/**
 * A tone channel as its product writes it ("SMS", "WhatsApp"); `generic` is the
 * caller's translated "everywhere"; an unknown id falls back to a capitalised id.
 */
export function channelLabel(channel: string, everywhere: string): string {
  if (channel === 'generic') return everywhere;
  const meta = TONE_CHANNELS.find((c) => c.id === channel) ?? DEPLOYMENT_CHANNELS.find((c) => c.id === channel);
  return meta ? meta.label : channelName(channel, everywhere);
}

/** Split `cells` units across parts by their share of the total (largest remainder, so they sum exactly). */
export function apportionCells(parts: readonly number[], cells: number): number[] {
  const total = parts.reduce((s, v) => s + v, 0);
  if (total <= 0) return parts.map(() => 0);
  const raw = parts.map((v) => (v / total) * cells);
  const out = raw.map(Math.floor);
  let left = cells - out.reduce((s, v) => s + v, 0);
  const order = raw.map((v, i) => ({ i, rem: v - Math.floor(v) })).sort((x, y) => y.rem - x.rem);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i] = (out[i] ?? 0) + 1;
    left -= 1;
  }
  return out;
}

/** Memories as plate waffle cells: one cell per memory while they fit, a share of the total once they do not. */
export function waffleCells(memories: TwinBlueprintModel['knowledge']['memories']): {
  approved: number;
  pending: number;
  rejected: number;
} | null {
  const { approved, pending, rejected } = memories;
  if (approved === null && pending === null && rejected === null) return null;
  const parts = [approved ?? 0, pending ?? 0, rejected ?? 0];
  const total = parts.reduce((s, v) => s + v, 0);
  const [a = 0, p = 0, r = 0] = total <= WAFFLE_CELLS ? parts : apportionCells(parts, WAFFLE_CELLS);
  return { approved: a, pending: p, rejected: r };
}

/** The plan's goals that still count (a dropped goal is drawn dashed, never in the mean). */
export function liveGoals(model: TwinBlueprintModel) {
  return model.training.goals.filter((g) => g.state !== 'dropped');
}

export interface StrataStat {
  key: string;
  label: string;
  /** `null` = not measured; drawn as "-". */
  value: number | null;
  unit?: 'ratio';
}

type MetricLabels = {
  bio: string; languages: string; readiness: string; channels: string; samples: string; rules: string;
  approved: string; awaiting: string; facts: string; answers: string; goals: string; observations: string;
};

/** The three quantities a plate's callout prints beside its headline fill. */
export function sectionStats(model: TwinBlueprintModel, section: SectionId, m: MetricLabels): StrataStat[] {
  switch (section) {
    case 'identity':
      return [
        { key: 'bio', label: m.bio, value: model.identity.bioChars },
        { key: 'languages', label: m.languages, value: model.identity.languages.length },
        { key: 'readiness', label: m.readiness, value: model.readiness.score / 100, unit: 'ratio' },
      ];
    case 'voice': {
      const ch = model.voice.channels;
      return [
        { key: 'channels', label: m.channels, value: ch.length },
        { key: 'samples', label: m.samples, value: ch.reduce((s, c) => s + c.exemplars, 0) },
        { key: 'rules', label: m.rules, value: ch.reduce((s, c) => s + c.rules, 0) },
      ];
    }
    case 'knowledge':
      return [
        { key: 'approved', label: m.approved, value: model.knowledge.memories.approved },
        { key: 'awaiting', label: m.awaiting, value: model.knowledge.memories.pending },
        { key: 'facts', label: m.facts, value: model.knowledge.facts },
      ];
    case 'training':
      return [
        { key: 'answers', label: m.answers, value: model.training.answered },
        { key: 'goals', label: m.goals, value: liveGoals(model).length },
        { key: 'observations', label: m.observations, value: model.training.observations },
      ];
  }
}
