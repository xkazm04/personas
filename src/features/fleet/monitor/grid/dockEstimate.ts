// What a dispatch is about to cost, before the trigger.
//
// The dock fires a real agent session into a real repository and, until this
// existed, told the operator nothing about the size of that commitment: the
// price of `opus × xhigh` arrived on an invoice, never on the console. These
// two gauges are the answer — an order-of-magnitude estimate that moves as the
// objective, the model and the effort change, so a dispatch is a judged
// commitment rather than a blind one.
//
// ## Honesty, because the number is a guess in a box that looks precise
//
// Two halves, and only ONE of them is guessed:
//
//   · The RATES ARE REAL — Anthropic's published per-MTok prices (table below,
//     dated). They are not relative weights invented to make the gauge move.
//   · The TOKEN VOLUME IS A HEURISTIC. Nobody can know in advance how many
//     tokens a session will spend; it depends on what the agent finds. The
//     per-effort figures below are anchored to sessions this repo has actually
//     measured (see `EFFORT_OUTPUT_TOKENS`), which makes them an informed
//     prior, not a measurement of the run about to happen.
//
// So the gauge renders `≈` and its tooltip says "estimate" in the operator's
// language. It is deliberately NOT presented as a quote, and nothing downstream
// bills against it. If per-session cost is ever recorded on `FleetSession`
// (it is not today — the struct carries no cost field), this should be
// recalibrated against the real distribution and this comment deleted.

import { formatCost, formatDuration } from '@/lib/utils/formatters';

/** A model preset as the composer holds it — `null` means "leave the CLI default". */
export type DockModel = string | null;
/** An effort preset as the composer holds it — `null` means "leave the CLI default". */
export type DockEffort = string | null;

/**
 * Published price per million tokens, in USD.
 *
 * Source: Anthropic's model pricing as carried by the `claude-api` skill's
 * model table (cached 2026-06-24). The dock's presets name a FAMILY (`opus`,
 * `sonnet`, `haiku`), not a version, because that is what the CLI's `--model`
 * alias accepts; each family resolves to its current generation, which is what
 * the alias resolves to too.
 */
interface Rate {
  in: number;
  out: number;
}

/** Claude Sonnet 5 — also the rate assumed when the preset is unset (below). */
const SONNET: Rate = { in: 2, out: 10 };

const RATES: Record<string, Rate | undefined> = {
  // Claude Opus 5
  opus: { in: 5, out: 25 },
  sonnet: SONNET,
  // Claude Haiku 4.5
  haiku: { in: 1, out: 5 },
};

/**
 * The rate used when the model preset is unset.
 *
 * `null` means "leave the CLI default", and the CLI's default is a per-machine
 * configuration this surface cannot read — so this is an assumption, not a
 * lookup. Sonnet is the CLI's general default tier. The composer says so in
 * the gauge tooltip rather than quietly pricing a run as if the operator had
 * chosen something.
 */
const DEFAULT_RATE: Rate = SONNET;

/**
 * Output tokens a session of each effort level tends to produce.
 *
 * Anchored to sessions measured on this machine rather than picked to make the
 * gauge look plausible: a `claude -p --effort xhigh` run building a UI
 * prototype reported 142,875 output tokens over 58 turns (2026-09-21), and a
 * `--effort high` run of comparable scope reported 151,232 over 59 turns. The
 * lower rungs are scaled from those two points, not measured — an agent
 * session at `low` was not sampled, so treat the bottom of this table as the
 * softest part of the estimate.
 */
const EFFORT_OUTPUT_TOKENS: Record<string, number> = {
  low: 18_000,
  medium: 45_000,
  high: 110_000,
  xhigh: 145_000,
};

/** Effort unset — between medium and high, matching the CLI's own `high` default leaning. */
const DEFAULT_EFFORT_TOKENS = 90_000;

/**
 * Input tokens a session reads that have nothing to do with the objective:
 * CLAUDE.md, the context map, the files the agent opens, the transcript it
 * re-sends every turn. The measured runs above read 8.9M–10.9M cached tokens;
 * cached reads are ~0.1x, so this is the cache-weighted equivalent rather than
 * the raw figure.
 */
const CONTEXT_INPUT_TOKENS = 220_000;

/** Rough token count of a prose objective — 4 characters per token. */
const charsPerToken = 4;

/** A skill loads its own instructions into the session before anything else. */
const SKILL_INPUT_TOKENS = 12_000;

export interface DockEstimate {
  /** USD. */
  cost: number;
  /** Minutes of wall clock. */
  minutes: number;
  /** True when the estimate priced a model the operator did not choose. */
  assumedModel: boolean;
}

/**
 * Wall clock, derived from the same token volume rather than invented
 * separately: the measured runs above sat near 80 output tokens/second of
 * wall clock end to end (142,875 tokens / 1,816 s and 151,232 / 2,391 s give
 * 79 and 63; the faster of the two was the shorter-thinking model).
 */
const TOKENS_PER_SECOND = 72;

/**
 * Estimate the cost and duration of a dispatch. Pure — no clock, no store, no
 * I/O — so the gauge can be unit-tested against the rate table directly.
 */
export function estimateDispatch(
  objective: string,
  model: DockModel,
  effort: DockEffort,
  hasSkill: boolean,
): DockEstimate {
  const rate: Rate = (model ? RATES[model] : undefined) ?? DEFAULT_RATE;
  const outTokens = (effort && EFFORT_OUTPUT_TOKENS[effort]) || DEFAULT_EFFORT_TOKENS;
  const inTokens =
    CONTEXT_INPUT_TOKENS + Math.ceil(objective.trim().length / charsPerToken) + (hasSkill ? SKILL_INPUT_TOKENS : 0);

  const cost = (inTokens / 1_000_000) * rate.in + (outTokens / 1_000_000) * rate.out;
  const minutes = outTokens / TOKENS_PER_SECOND / 60;

  return { cost, minutes, assumedModel: !model || !RATES[model] };
}

/**
 * Render the estimate through the number layer, never by welding a `$` onto a
 * `toFixed`. `formatCost` owns the rounding contract, the locale's separator
 * and the symbol's position — a hand-assembled `$${'{'}x.toFixed(2){'}'}` would decide
 * all three here, for one locale, and the census rule `hand-assembled-currency`
 * exists because this repo has done that 36 times already.
 */
export function formatEstimateCost(cost: number): string {
  return formatCost(cost, { precision: 2 });
}

/**
 * The wall-clock gauge. `formatDuration` speaks in ms and already knows the
 * minute/hour break, so the estimate is converted rather than re-formatted —
 * one module decides what a duration looks like in this app.
 *
 * The floor is deliberate: an estimate that rounds to zero would read as
 * "instant" for work that is never instant.
 */
export function formatEstimateMinutes(minutes: number): string {
  return formatDuration(Math.max(1, Math.round(minutes)) * 60_000);
}
