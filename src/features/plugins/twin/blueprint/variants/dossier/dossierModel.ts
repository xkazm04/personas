/**
 * Dossier (spark twin-portable-blueprint, WP9): the pure arithmetic behind the
 * instrument tiles. Every scale is a DECLARED domain (a cap the prompt
 * compiler renders, the 1..5 style range, a coverage threshold, a 0..1
 * share), never the sample's own min/max, so a tile drawn today and one drawn
 * after ten more answers stay comparable.
 *
 * Could be shared: `deltaSection` and `channelLabel` answer the same questions
 * the other variants answer locally.
 */
import { DEPLOYMENT_CHANNELS, TONE_CHANNELS } from '../../../shared/channels';
import { channelName } from '../../../experience/channels';
import { COVERAGE_COVERED_THRESHOLD } from '../../../sub_training/topicCoverage';
import { quantumFor, type Tone } from '@/features/shared/components/kit';
import type {
  BlueprintChannel, BlueprintDelta, SectionId, StepKind, TwinBlueprintModel, VoiceOrigin,
} from '../../blueprintContract';

/** The prompt compiler renders up to five exemplars per channel (WP2). */
export const EXEMPLARS_FULL_AT = 5;
/** ...and up to eight constraints per channel. */
export const RULES_FULL_AT = 8;
/** Style dims are integers 1..5 (styleContract.ts). */
export const DIM_MAX = 5;
/** A topic is covered at this many approved answers (topicCoverage.ts). */
export const TOPIC_COVERED_AT = COVERAGE_COVERED_THRESHOLD;
/** A topic bar runs to twice the covered threshold, so "covered" sits at its middle. */
export const TOPIC_DOMAIN = COVERAGE_COVERED_THRESHOLD * 2;
/** Channel rows a Voice tile draws on layer one before it folds the rest into "+N". */
export const VOICE_ROWS_L1 = 5;
/** ...when the content area is wide enough to hold every tone channel at full size. */
export const VOICE_ROWS_ROOMY = 9;
/** Bento width (px) from which layer one draws the roomy form. */
export const ROOMY_AT = 1400;
/** ...and on the narrower stage rail, and on a stage rail with room. */
export const VOICE_ROWS_STAGE = 4;
export const VOICE_ROWS_STAGE_ROOMY = 6;
/** Stage rail width (px) from which a rail draws its labelled, fuller form. */
export const RAIL_ROOMY_AT = 340;
/** Units a bio strip draws at most on a layer-one tile, a stage rail and an L2 board (its quantum grows past that). */
export const BIO_UNITS = { glance: 14, compact: 18, board: 24 } as const;
/** Units a memory strip draws at most per row. */
export const MEMORY_UNITS_PER_ROW = 24;

export const STEP_KINDS: readonly StepKind[] = ['scene', 'opinion', 'reply_drill', 'fact', 'rule', 'preference'];

/** One tone per question kind, from the kit's role vocabulary (no status meaning borrowed). */
export const KIND_TONE: Record<StepKind, Tone> = {
  scene: 'primary',
  opinion: 'highlight',
  reply_drill: 'info',
  fact: 'external',
  rule: 'agent',
  preference: 'human',
};

/** Where a channel's style came from, as a kit glyph. `null` = never voiced. */
export function originMark(origin: VoiceOrigin | null): { tone: Tone; glyph: 'solid' | 'soft' | 'hollow' } {
  switch (origin) {
    case 'learned':
      return { tone: 'success', glyph: 'solid' };
    case 'rolled':
      return { tone: 'highlight', glyph: 'solid' };
    case 'preset':
      return { tone: 'primary', glyph: 'solid' };
    case 'manual':
      return { tone: 'neutral', glyph: 'solid' };
    default:
      return { tone: 'neutral', glyph: 'hollow' };
  }
}

export const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** A count on a declared domain as a 0..1 share (overflow clamps; the caller marks it). */
export const share = (value: number, domain: number) => clamp01(value / domain);

/**
 * A tone channel as its product writes it ("SMS", "WhatsApp"); `generic` is the
 * caller's translated "everywhere"; an unknown id falls back to a capitalised id.
 */
export function channelLabel(channel: string, everywhere: string): string {
  if (channel === 'generic') return everywhere;
  const meta = TONE_CHANNELS.find((c) => c.id === channel) ?? DEPLOYMENT_CHANNELS.find((c) => c.id === channel);
  return meta ? meta.label : channelName(channel, everywhere);
}

/** The rows a list of `cap` draws: all of them when they fit, else `cap - 1` and a "+N" row. */
export function foldRows<T>(items: readonly T[], cap: number): { shown: readonly T[]; more: number } {
  if (items.length <= cap) return { shown: items, more: 0 };
  const keep = Math.max(1, cap - 1);
  return { shown: items.slice(0, keep), more: items.length - keep };
}

/**
 * Which tile an answer lands on: the goal's slot when the goal is known, then
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
 * The bio drawn against its target: units of `quantum` characters, filled to
 * the bio, running at least to the target (the tick). `null` = no bio stored.
 */
export function bioStrip(bioChars: number | null, target: number, maxUnits: number) {
  if (bioChars === null) return null;
  const span = Math.max(bioChars, target);
  const quantum = quantumFor(span, maxUnits);
  const filled = bioChars / quantum;
  const empty = Math.max(0, target / quantum - filled);
  return { quantum, filled, empty, targetAt: target / quantum };
}

/** True when every memory count is unmeasured (the strip draws "not measured"). */
export function memoriesUnmeasured(m: TwinBlueprintModel['knowledge']['memories']): boolean {
  return m.approved === null && m.pending === null && m.rejected === null;
}

/** The channel ids of a model, `generic` first (the model already orders them). */
export function channelIds(channels: readonly BlueprintChannel[]): string[] {
  return channels.map((c) => c.channel);
}

/** Answered steps by kind, in display order, zero kinds dropped. */
export function kindParts(kindMix: Partial<Record<StepKind, number>>): Array<{ kind: StepKind; n: number }> {
  return STEP_KINDS.map((kind) => ({ kind, n: kindMix[kind] ?? 0 })).filter((p) => p.n > 0);
}
