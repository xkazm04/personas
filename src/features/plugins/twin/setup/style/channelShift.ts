/**
 * The deterministic per-channel register shift.
 *
 * One chosen style becomes one TARGET per channel: an email reads a notch more
 * formal and less expressive than the generic voice, an SMS shorter and
 * lighter, a voice reply short and emoji-free. Pure and client-side so the
 * preview is reproducible and the LLM is only asked to WRITE the tone, never to
 * decide how far a channel moves it.
 */

import { MAX_EXTREMES, clampLevel, extremeCount, isExtreme, makeCoherent } from './styleDims';
import type { StyleChannelTarget, StyleDimension, TwinStyleDims } from './styleContract';

type Shift = Partial<Record<StyleDimension, number>>;

/** Relative moves per channel. Channels not listed read as `generic` (no shift). */
const CHANNEL_SHIFTS: Record<string, Shift> = {
  generic: {},
  email: { formality: 1, expressiveness: -1 },
  slack: { formality: -1 },
  teams: { formality: -1 },
  discord: { formality: -1, expressiveness: 1 },
  telegram: { formality: -1, length: -1 },
  whatsapp: { formality: -1, length: -1 },
  sms: { formality: -1, length: -1, detail: -1 },
  voice: { length: -1, detail: -1 },
};

/** Absolute overrides applied after the relative shift. Speech carries no emoji. */
const CHANNEL_SETS: Record<string, Shift> = {
  voice: { expressiveness: 1 },
};

export function shiftForChannel(base: TwinStyleDims, channel: string): TwinStyleDims {
  const key = channel.trim().toLowerCase();
  const shift = CHANNEL_SHIFTS[key] ?? {};
  const set = CHANNEL_SETS[key] ?? {};
  const out = { ...base };
  for (const [dim, delta] of Object.entries(shift) as [StyleDimension, number][]) {
    out[dim] = clampLevel(out[dim] + delta);
  }
  for (const [dim, value] of Object.entries(set) as [StyleDimension, number][]) {
    out[dim] = clampLevel(value);
  }
  // The fix may not push the style past the extremes its BASE already had: a
  // shift must never make a style less coherent, and it must never flatten a
  // curated preset that sits at more extremes by design. An absolute channel
  // setting (speech carries no emoji) is a property of the medium, not of the
  // style, so an extreme it introduces is added to the budget, not fought.
  const locked = Object.keys(set) as StyleDimension[];
  const mediumExtremes = locked.filter(
    (d) => isExtreme(out[d]) && !isExtreme(base[d]),
  ).length;
  return makeCoherent(out, {
    extremeBudget: Math.max(MAX_EXTREMES, extremeCount(base)) + mediumExtremes,
    locked,
    fallback: Object.keys(shift) as StyleDimension[],
  });
}

/** One materialize target per channel, in the order the channels were given. */
export function targetsFor(base: TwinStyleDims, channels: readonly string[]): StyleChannelTarget[] {
  return channels.map((channel) => ({ channel, dims: shiftForChannel(base, channel) }));
}
