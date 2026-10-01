/**
 * The drafting sheet's drawing rules for a twin (spark twin-portable-blueprint,
 * WP7), as pure functions so the components only paint. Every scale here is a
 * DECLARED domain (dims 1..5, coverage 0..1, the readiness and tier
 * thresholds), never one derived from the sample: a quantity past its scale is
 * drawn full with a "not to scale" break mark and its real number beside it.
 */
import type { TwinStyleDims } from '@/lib/bindings/TwinStyleDims';
import { COVERAGE_COVERED_THRESHOLD, COVERAGE_SOME_THRESHOLD } from '../../../sub_training/topicCoverage';
import type { BlueprintChannel, BlueprintDelta, SectionId, StepKind, TwinBlueprintModel } from '../../blueprintContract';

/** The eight style dimensions, in the order the style studio lists them. */
export const DIM_KEYS: readonly (keyof TwinStyleDims)[] = [
  'formality',
  'warmth',
  'humor',
  'energy',
  'length',
  'directness',
  'expressiveness',
  'detail',
];
/** A style dimension is an integer 1..5 (the Rust style door is the authority). */
export const DIM_MAX = 5;

/** Every step kind, in the engine's order. */
export const STEP_KINDS: readonly StepKind[] = ['scene', 'opinion', 'reply_drill', 'fact', 'rule', 'preference'];

/** The bio scale runs to this many times its target; a longer bio breaks the line. */
export const BIO_SCALE_FACTOR = 4;
/** Exemplar and rule ticks drawn on a channel before the tick row breaks. */
export const TICK_CAP = 10;
/** A topic bar runs to twice the "covered" threshold. */
export const TOPIC_SCALE_MAX = COVERAGE_COVERED_THRESHOLD * 2;
export const TOPIC_TIER_MARKS = [COVERAGE_SOME_THRESHOLD, COVERAGE_COVERED_THRESHOLD] as const;
/** One tally gate is five strokes. */
export const TALLY_GATE = 5;

/**
 * How a region (or a mark inside one) is inked:
 * `unmeasured` = nothing to measure yet (hatched), `pending` = measured and
 * empty (dashed outline), `drawing` = partly inked, `done` = solid ink.
 */
export type Ink = 'unmeasured' | 'pending' | 'drawing' | 'done';

export function inkOf(coverage: number | null): Ink {
  if (coverage === null) return 'unmeasured';
  if (coverage <= 0) return 'pending';
  return coverage >= 1 ? 'done' : 'drawing';
}

/** A value on a declared scale: the drawn share (0..1) and whether it ran past the scale. */
export function onScale(value: number, max: number): { share: number; broken: boolean } {
  if (max <= 0) return { share: 0, broken: false };
  return { share: Math.min(1, Math.max(0, value / max)), broken: value > max };
}

/**
 * A channel's voice as drawn: `voiced` has written directives (solid frame),
 * `styled` only a stored style (dashed frame, bars drawn), `manual` a hand
 * written tone with no style (hatched bars), `unvoiced` no tone row at all.
 */
export type ChannelState = 'voiced' | 'styled' | 'manual' | 'unvoiced';

export function channelState(c: BlueprintChannel): ChannelState {
  if (c.origin === null) return 'unvoiced';
  if (c.hasDirectives) return 'voiced';
  return c.dims ? 'styled' : 'manual';
}

/** Tally strokes as gates of five, up to `gates` full gates; more breaks the row. */
export function tallyGates(count: number, gates: number): { strokes: number[]; broken: boolean } {
  const capacity = gates * TALLY_GATE;
  const drawn = Math.min(count, capacity);
  const strokes: number[] = [];
  for (let left = drawn; left > 0; left -= TALLY_GATE) strokes.push(Math.min(TALLY_GATE, left));
  return { strokes, broken: count > capacity };
}

/** The answered kinds as shares of all answered steps (part of a whole), in engine order. */
export function kindShares(mix: Partial<Record<StepKind, number>>): { kind: StepKind; n: number; share: number }[] {
  const entries = STEP_KINDS.map((kind) => ({ kind, n: mix[kind] ?? 0 })).filter((e) => e.n > 0);
  const whole = entries.reduce((sum, e) => sum + e.n, 0);
  return whole === 0 ? [] : entries.map((e) => ({ ...e, share: e.n / whole }));
}

/** The section a plan goal's slot belongs to. */
export function sectionOfSlot(slot: string): SectionId {
  if (slot === 'identity') return 'identity';
  if (slot === 'tone' || slot === 'channels') return 'voice';
  if (slot === 'memories') return 'knowledge';
  return 'training';
}

/** Where the last answer lands on the sheet: the section, and the mark inside it (a target key). */
export interface DeltaTarget {
  section: SectionId;
  /** `topic:<id>`, `goal:<id>`, `channel:<id>` or `region:<section>`. */
  key: string;
  goalId: string | null;
}

export function deltaTarget(delta: BlueprintDelta, model: TwinBlueprintModel): DeltaTarget {
  const goal = delta.goalId ? model.training.goals.find((g) => g.id === delta.goalId) ?? null : null;
  const goalId = goal?.id ?? null;
  if (delta.topicId) return { section: 'training', key: `topic:${delta.topicId}`, goalId };
  if (goal) {
    const section = sectionOfSlot(goal.slot);
    if (section === 'training') {
      const topic = goal.slot.startsWith('training:') ? goal.slot.slice('training:'.length) : null;
      return { section, key: topic ? `topic:${topic}` : `goal:${goal.id}`, goalId };
    }
    if (section === 'voice' && delta.channel) return { section, key: `channel:${delta.channel}`, goalId };
    return { section, key: `region:${section}`, goalId };
  }
  if (delta.channel) return { section: 'voice', key: `channel:${delta.channel}`, goalId };
  return { section: 'training', key: 'region:training', goalId };
}

/** The L1 voice grid: up to nine glyphs; past that the ninth cell counts the rest. */
export const VOICE_L1_CELLS = 9;

export function voiceColumns(count: number): number {
  if (count <= 1) return 1;
  return count <= 4 ? 2 : 3;
}
