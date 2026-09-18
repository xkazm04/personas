/**
 * Style studio wire contract (spark twin-presets).
 *
 * The Rust structs are the authority for the WIRE types and are re-exported
 * from the generated bindings. This file adds the client-side vocabulary the
 * studio UI and its hook are built against, so the engine (Rust) and the
 * studio (TS) packages compile independently.
 *
 * The governing rules:
 * - A style is 8 dimensions, each an integer 1..5. Order below is the one
 *   authority for display order and for the vitest catalog invariants.
 * - Presets are the curated core; rolled styles are the generated tail. The
 *   UI keeps them visibly distinct (`source`), never letting a rolled style
 *   impersonate a preset (templates-scaffolding / catalog-curation).
 * - Roll and materialize are proposals. Nothing is written until the user
 *   accepts a previewed draft (`applyTwinStyle`).
 */

import { safeJsonParse } from '@/lib/utils/parseJson';
import type { StyleCandidate } from '@/lib/bindings/StyleCandidate';
import type { StyleChannelTarget } from '@/lib/bindings/StyleChannelTarget';
import type { StyleToneDraft } from '@/lib/bindings/StyleToneDraft';
import type { TwinStyle } from '@/lib/bindings/TwinStyle';
import type { TwinStyleDims } from '@/lib/bindings/TwinStyleDims';
import type { TwinStylePins } from '@/lib/bindings/TwinStylePins';

export type { StyleCandidate, StyleChannelTarget, StyleToneDraft, TwinStyle, TwinStyleDims, TwinStylePins };

/** One of the 8 dimensions. */
export type StyleDimension = keyof TwinStyleDims;

/** Display order; also the order of the dimension chips. */
export const STYLE_DIMENSIONS: readonly StyleDimension[] = [
  'formality',
  'warmth',
  'humor',
  'energy',
  'length',
  'directness',
  'expressiveness',
  'detail',
] as const;

export const STYLE_MIN = 1;
export const STYLE_MAX = 5;

export type StyleSource = 'preset' | 'rolled';

/** The ten curated presets. Ids are stable wire values (stored in style_json). */
export type StylePresetId =
  | 'executive-brief'
  | 'polished-professional'
  | 'consultative-expert'
  | 'plainspoken-direct'
  | 'warm-helpful'
  | 'friendly-casual'
  | 'empathic-listener'
  | 'upbeat-cheerleader'
  | 'witty-wry'
  | 'close-informal';

/**
 * A curated preset. Copy is never an English literal here: name, summary,
 * avoid (anti-tone) and the gallery sample reply live under
 * `twin.style.presets.<id>.{name,summary,avoid,sample}`.
 */
export interface StylePreset {
  id: StylePresetId;
  dims: TwinStyleDims;
}

/** The studio's state machine. One phase at a time; the panel renders by it. */
export type StyleStudioPhase =
  | 'browse' // gallery of presets + the Roll affordance
  | 'rolling' // roll in flight (3 ghost candidates under chrome)
  | 'candidates' // 3 rolled candidates side by side
  | 'materializing' // one chosen style being written per channel (ghost preview)
  | 'preview' // per-channel current vs proposed, channel checkboxes
  | 'applying'; // accept in flight

/** A failed step. `message` is the resolved, user-facing text. */
export interface StyleStudioError {
  step: 'roll' | 'materialize' | 'apply';
  message: string;
}

/** What the studio exposes to its renderers (`useStyleStudio(twinId, channels)`). */
export interface StyleStudioApi {
  phase: StyleStudioPhase;
  /** Channels a style is materialized for: generic + every bound channel type. */
  channels: string[];
  pins: TwinStylePins;
  togglePin: (dim: StyleDimension, value: number) => void;
  clearPins: () => void;
  candidates: StyleCandidate[];
  /** The style being previewed / applied, if any. */
  chosen: TwinStyle | null;
  drafts: StyleToneDraft[];
  /** Channels ticked for apply; defaults to every drafted channel. */
  selectedChannels: Set<string>;
  toggleChannel: (channel: string) => void;
  /** Last failure and which step raised it; previous candidates/drafts are kept on failure. */
  error: StyleStudioError | null;
  pickPreset: (id: StylePresetId) => Promise<void>;
  roll: () => Promise<void>;
  pickCandidate: (id: string) => Promise<void>;
  accept: () => Promise<void>;
  /** Preview -> where it came from (candidates or browse); candidates -> browse. */
  back: () => void;
  /** Clear the inline failure notice without changing the phase. */
  dismissError: () => void;
}

/**
 * The create dialog records a choice; Setup Fields consumes it once.
 * `kind: 'roll'` is the "Surprise me" tile.
 */
export type StyleStart = { kind: 'preset'; presetId: StylePresetId } | { kind: 'roll' };

/** Shape check for a stored style: every wire field present, source a known value. */
function isTwinStyle(value: unknown): value is TwinStyle {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.name !== 'string') return false;
  if (v.source !== 'preset' && v.source !== 'rolled') return false;
  const dims = v.dims as Record<string, unknown> | null | undefined;
  if (!dims || typeof dims !== 'object') return false;
  return STYLE_DIMENSIONS.every((d) => typeof dims[d] === 'number');
}

/** Parse a tone row's `style_json`. Returns null for hand-written or malformed rows. */
export function parseToneStyle(styleJson: string | null | undefined): TwinStyle | null {
  // `safeJsonParse` rather than a try/catch: a hand-written row carries no
  // style and a malformed one is an expected input, not a failure to report.
  // INVARIANT: style_json is only ever written by twin_style_apply from a
  // serialized TwinStyle; the guard rejects anything else.
  const [parsed] = safeJsonParse(styleJson, isTwinStyle);
  return parsed;
}
