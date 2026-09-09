// Shared navigation model for every 3D variant — the "layers" of the Jarvis
// brief written once, so the three worlds differ only in how they LOOK, never
// in what a click does:
//
//   L0 portfolio  — every project, abstract shape, rough state. One glance.
//   L1 project    — one project, every dimension exploded into its categories.
//   L2 dimension  — one dimension only: status, progress, tool, headline stat.
//
// Athena operates on the same model: her scripted operations are plain
// reducer actions (fly / highlight / override), which is exactly how the real
// companion would drive the world through canvasActionStore later.
//
// Pure — no React, no three. Unit-testable on its own.
import type { DimKey } from '../lib/dimRegistry';
import type { DimStatus } from '../lib/types';

export type WorldLevel = 0 | 1 | 2;

export interface WorldFocus {
  level: WorldLevel;
  project: string | null;
  dim: DimKey | null;
}

/** A transcript line — who said it and which i18n key (with interpolation
 *  params) carries the copy. Keys, not strings, so the transcript translates. */
export interface WorldTranscriptLine {
  id: number;
  who: 'athena' | 'you';
  key: string;
  params?: Record<string, string | number>;
}

/** A status Athena changed in the world (demo of "operate", not just "look"). */
export type StatusOverrides = Record<string, { status: DimStatus; detail: string; figure: string | null }>;

export interface WorldState {
  focus: WorldFocus;
  /** Hovered node id (`slug` or `slug:dimKey`). */
  hover: string | null;
  /** Node ids Athena is currently pointing at. */
  highlight: ReadonlySet<string>;
  overrides: StatusOverrides;
  transcript: WorldTranscriptLine[];
  /** Athena is mid-operation — the HUD shows her busy and disables the chips. */
  athenaBusy: boolean;
  /** Monotonic counter — every focus change bumps it so a camera rig can
   *  re-fly even when the pose happens to be identical. */
  flight: number;
}

export type WorldAction =
  | { type: 'open-project'; slug: string }
  | { type: 'open-dim'; slug: string; dim: DimKey }
  | { type: 'up' }
  | { type: 'home' }
  | { type: 'hover'; id: string | null }
  | { type: 'highlight'; ids: string[] }
  | { type: 'override'; id: string; status: DimStatus; detail: string; figure: string | null }
  | { type: 'say'; who: WorldTranscriptLine['who']; key: string; params?: Record<string, string | number> }
  | { type: 'busy'; busy: boolean };

export const HOME: WorldFocus = { level: 0, project: null, dim: null };

export const initialWorldState = (): WorldState => ({
  focus: HOME,
  hover: null,
  highlight: new Set(),
  overrides: {},
  transcript: [],
  athenaBusy: false,
  flight: 0,
});

export const nodeId = (slug: string, dim?: DimKey | null): string => (dim ? `${slug}:${dim}` : slug);

let lineSeq = 0;

export function worldReducer(s: WorldState, a: WorldAction): WorldState {
  switch (a.type) {
    case 'open-project':
      return { ...s, focus: { level: 1, project: a.slug, dim: null }, flight: s.flight + 1 };
    case 'open-dim':
      return { ...s, focus: { level: 2, project: a.slug, dim: a.dim }, flight: s.flight + 1 };
    case 'up': {
      if (s.focus.level === 0) return s;
      const focus: WorldFocus = s.focus.level === 2
        ? { level: 1, project: s.focus.project, dim: null }
        : HOME;
      return { ...s, focus, flight: s.flight + 1 };
    }
    case 'home':
      return s.focus.level === 0 && s.highlight.size === 0 ? s : { ...s, focus: HOME, highlight: new Set(), flight: s.flight + 1 };
    case 'hover':
      return s.hover === a.id ? s : { ...s, hover: a.id };
    case 'highlight':
      return { ...s, highlight: new Set(a.ids) };
    case 'override':
      return { ...s, overrides: { ...s.overrides, [a.id]: { status: a.status, detail: a.detail, figure: a.figure } } };
    case 'say':
      return { ...s, transcript: [...s.transcript.slice(-5), { id: ++lineSeq, who: a.who, key: a.key, params: a.params }] };
    case 'busy':
      return s.athenaBusy === a.busy ? s : { ...s, athenaBusy: a.busy };
    default:
      return s;
  }
}

/** Visibility/emphasis of a node given the focus — the one rule all three
 *  worlds share, so "what fades when I drill down" is consistent. 1 = fully
 *  present, 0 = ghosted. */
export function nodeEmphasis(focus: WorldFocus, slug: string, dim: DimKey | null): number {
  if (focus.level === 0) return dim ? 0.35 : 1;
  const mine = focus.project === slug;
  if (focus.level === 1) {
    if (!mine) return dim ? 0.08 : 0.3;
    return 1;
  }
  // level 2 — one dimension only
  if (!mine) return dim ? 0.04 : 0.18;
  if (!dim) return 0.55;
  return dim === focus.dim ? 1 : 0.16;
}
