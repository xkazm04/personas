/**
 * One "how drawn is this section" number per blueprint section, 0..1, shared
 * by every variant so the four renderers agree on what a full ring, a full
 * plate or an inked region means (spark twin-portable-blueprint, WP0).
 *
 * `null` = nothing to measure yet (draw it as "not drawn", never as empty).
 * The formulas are deliberately simple and documented here; a variant may draw
 * finer sub-quantities from the model, but its headline fill comes from here.
 */
import type { ReadinessStatus, SectionId, TwinBlueprintModel } from './blueprintContract';

/** Approved memories at which Knowledge reads as fully drawn (matches the readiness memories target). */
export const KNOWLEDGE_FULL_AT = 5;

const STATUS_WEIGHT: Record<ReadinessStatus, number> = { set: 1, partial: 0.5, empty: 0 };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * - identity: bio length against its target (0.8 weight) + any language (0.2).
 * - voice: share of channels with written directives, half credit for a stored style without directives.
 * - knowledge: approved memories against `KNOWLEDGE_FULL_AT`.
 * - training: mean coverage of the plan's non-dropped goals; `null` before the first plan.
 */
export function sectionCoverage(model: TwinBlueprintModel): Record<SectionId, number | null> {
  const { identity, voice, knowledge, training } = model;

  const bio = identity.bioChars === null ? 0 : clamp01(identity.bioChars / identity.bioTarget);
  const identityFill = clamp01(bio * 0.8 + (identity.languages.length > 0 ? 0.2 : 0));

  const channels = voice.channels;
  const voiceFill =
    channels.length === 0
      ? null
      : clamp01(
          channels.reduce((sum, c) => sum + (c.hasDirectives ? 1 : c.dims ? 0.5 : 0), 0) / channels.length,
        );

  const approved = knowledge.memories.approved;
  const knowledgeFill = approved === null ? null : clamp01(approved / KNOWLEDGE_FULL_AT);

  const live = training.goals.filter((g) => g.state !== 'dropped');
  const trainingFill = live.length === 0 ? null : clamp01(live.reduce((s, g) => s + g.coverage, 0) / live.length);

  return { identity: identityFill, voice: voiceFill, knowledge: knowledgeFill, training: trainingFill };
}

/** The readiness slot status as a 0..1 weight (for variants that draw the four slots). */
export function readinessWeight(status: ReadinessStatus): number {
  return STATUS_WEIGHT[status];
}
